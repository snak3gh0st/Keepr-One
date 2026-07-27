import type { BrowserSession } from '../../workers/national-life/types'

type RequestRecord = {
  method: string
  url: string
  body: string | null
}

type CreateFakeBrowserSessionResult = {
  session: BrowserSession
  requests: RequestRecord[]
}

type ElementNode = {
  kind: 'element'
  uid: string
  tagName: string
  attributes: Record<string, string>
  children: Array<ElementNode | TextNode>
  parent: ElementNode | null
}

type TextNode = {
  kind: 'text'
  text: string
  parent: ElementNode | null
}

type SimpleSelector = {
  tagName?: string
  attrName?: string
  attrValue?: string
}

type RoleName = 'button' | 'heading' | 'link'

type LocatorOptions = {
  name?: string
}

const SELECTOR_NOT_FOUND_CODE = 'SELECTOR_NOT_FOUND'
const READ_ONLY_VIOLATION_CODE = 'READ_ONLY_VIOLATION'
const FIXTURE_ORIGIN_INVALID_CODE = 'FIXTURE_ORIGIN_INVALID'
const DEFAULT_TIMEOUT_MS = 5_000

class FakeBrowserError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

class FakeLocator {
  constructor(
    private readonly page: FakePage,
    private readonly elements: ElementNode[],
  ) {}

  locator(selector: string) {
    const matches = this.elements.flatMap((element) => querySelectorAll(element, selector))
    return new FakeLocator(this.page, matches)
  }

  async count() {
    return this.elements.length
  }

  nth(index: number) {
    return new FakeLocator(this.page, this.elements[index] ? [this.elements[index]] : [])
  }

  async textContent() {
    const element = this.first()
    return element ? normalizeWhitespace(getTextContent(element)) : null
  }

  async getAttribute(name: string) {
    return this.first()?.attributes[name] ?? null
  }

  async fill(value: string) {
    const element = this.requiredFirst('fill')
    const fieldName = getControlName(element)

    if (!fieldName) {
      throw new FakeBrowserError(SELECTOR_NOT_FOUND_CODE, 'Form control is missing name or id')
    }

    this.page.setFormValue(fieldName, value)
  }

  async click() {
    const element = this.requiredFirst('click')

    if (element.tagName === 'a') {
      const href = element.attributes.href
      if (!href) {
        throw new FakeBrowserError(SELECTOR_NOT_FOUND_CODE, 'Link is missing href')
      }

      await this.page.navigate(new URL(href, this.page.url()).toString(), 'GET')
      return
    }

    if (element.tagName === 'button') {
      const form = findAncestor(element, 'form')
      if (!form) {
        throw new FakeBrowserError(SELECTOR_NOT_FOUND_CODE, 'Submit button is not inside a form')
      }

      await this.page.submitForm(form)
      return
    }

    throw new FakeBrowserError(SELECTOR_NOT_FOUND_CODE, `Unsupported click target: ${element.tagName}`)
  }

  private first() {
    return this.elements[0] ?? null
  }

  private requiredFirst(action: string) {
    const element = this.first()
    if (!element) {
      throw new FakeBrowserError(SELECTOR_NOT_FOUND_CODE, `${action} target not found`)
    }
    return element
  }
}

class FakePage {
  private currentUrl = 'about:blank'
  private currentDocument = createRoot()
  private readonly formValues = new Map<string, string>()
  private loginPostSeen = false

  constructor(
    private readonly baseUrl: string,
    private readonly requests: RequestRecord[],
  ) {}

  async goto(url: string) {
    await this.navigate(url, 'GET')
  }

  getByLabel(label: string) {
    const match = findControlByLabel(this.currentDocument, label)
    return new FakeLocator(this, match ? [match] : [])
  }

  getByRole(role: RoleName, options?: LocatorOptions) {
    const elements = findByRole(this.currentDocument, role, options?.name)
    return new FakeLocator(this, elements)
  }

  locator(selector: string) {
    return new FakeLocator(this, querySelectorAll(this.currentDocument, selector))
  }

  url() {
    return this.currentUrl
  }

  async navigate(url: string, method: 'GET' | 'POST', body?: URLSearchParams) {
    const targetUrl = new URL(url, this.baseUrl)
    const bodyText = body?.toString() ?? null

    this.assertAllowedWrite(method, targetUrl)
    this.requests.push({ method, url: targetUrl.toString(), body: bodyText })

    const response = await fetch(targetUrl, {
      method,
      body: bodyText,
      headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
      redirect: 'manual',
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw new Error('Redirect response missing location header')
      }

      await this.navigate(new URL(location, targetUrl).toString(), 'GET')
      return
    }

    this.currentUrl = targetUrl.toString()
    this.currentDocument = parseHtml(await response.text())
    this.formValues.clear()
  }

  async submitForm(form: ElementNode) {
    const action = form.attributes.action
    const method = (form.attributes.method ?? 'get').toUpperCase()

    if (!action) {
      throw new FakeBrowserError(SELECTOR_NOT_FOUND_CODE, 'Form action is missing')
    }

    const params = new URLSearchParams()
    const controls = querySelectorAll(form, 'input')

    for (const control of controls) {
      const name = getControlName(control)
      if (!name) {
        continue
      }
      params.set(name, this.formValues.get(name) ?? control.attributes.value ?? '')
    }

    if (method === 'GET') {
      const targetUrl = new URL(action, this.baseUrl)
      targetUrl.search = params.toString()
      await this.navigate(targetUrl.toString(), 'GET')
      return
    }

    if (method === 'POST') {
      await this.navigate(new URL(action, this.baseUrl).toString(), 'POST', params)
      return
    }

    throw new FakeBrowserError(READ_ONLY_VIOLATION_CODE, `Unsupported form method ${method}`)
  }

  setFormValue(name: string, value: string) {
    this.formValues.set(name, value)
  }

  private assertAllowedWrite(method: 'GET' | 'POST', url: URL) {
    if (method === 'GET') {
      return
    }

    if (!this.loginPostSeen && method === 'POST' && url.pathname === '/session/login') {
      this.loginPostSeen = true
      return
    }

    throw new FakeBrowserError(READ_ONLY_VIOLATION_CODE, `Unexpected ${method} request to ${url.pathname}`)
  }
}

export async function createFakeBrowserSession(input: {
  baseUrl: string
  startPath?: string
}): Promise<CreateFakeBrowserSessionResult> {
  const fixtureBaseUrl = parseFixtureBaseUrl(input.baseUrl)
  const requests: RequestRecord[] = []
  const page = new FakePage(fixtureBaseUrl.toString(), requests)

  if (input.startPath) {
    await page.goto(new URL(input.startPath, fixtureBaseUrl).toString())
  }

  return {
    requests,
    session: {
      browser: {} as BrowserSession['browser'],
      context: {} as BrowserSession['context'],
      page: page as never,
      steelSessionId: 'fake-steel-session',
      debugUrl: new URL('/debug', fixtureBaseUrl).toString(),
      async close() {},
      async disconnect() {},
    },
  }
}

function parseFixtureBaseUrl(baseUrl: string) {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(baseUrl)
  } catch {
    throw new FakeBrowserError(FIXTURE_ORIGIN_INVALID_CODE, 'Fixture browser baseUrl must be a valid URL')
  }

  const isExactFixtureOrigin =
    parsedUrl.protocol === 'http:' &&
    parsedUrl.hostname === '127.0.0.1' &&
    parsedUrl.port !== '' &&
    parsedUrl.username === '' &&
    parsedUrl.password === '' &&
    parsedUrl.pathname === '/' &&
    parsedUrl.search === '' &&
    parsedUrl.hash === ''

  if (!isExactFixtureOrigin) {
    throw new FakeBrowserError(
      FIXTURE_ORIGIN_INVALID_CODE,
      'Fixture browser baseUrl must use exact fixture origin shape http://127.0.0.1:<port>',
    )
  }

  return new URL(parsedUrl.origin)
}

export function waitForRequests(requests: RequestRecord[], expectedCount: number, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()

    const poll = () => {
      if (requests.length >= expectedCount) {
        resolve()
        return
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${expectedCount} request(s)`))
        return
      }

      setTimeout(poll, 10)
    }

    poll()
  })
}

function createRoot(): ElementNode {
  return {
    kind: 'element',
    uid: 'root',
    tagName: 'root',
    attributes: {},
    children: [],
    parent: null,
  }
}

function parseHtml(html: string) {
  const root = createRoot()
  const stack: ElementNode[] = [root]
  let uidCounter = 0
  const tokens = html.match(/<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[^>]+>|[^<]+/gi) ?? []

  for (const token of tokens) {
    if (!token || /^<!doctype/i.test(token) || /^<!--/.test(token)) {
      continue
    }

    if (token.startsWith('</')) {
      stack.pop()
      continue
    }

    if (token.startsWith('<')) {
      const selfClosing = token.endsWith('/>')
      const tagMatch = /^<\s*([a-zA-Z0-9-]+)/.exec(token)
      if (!tagMatch) {
        continue
      }

      const element: ElementNode = {
        kind: 'element',
        uid: `node-${uidCounter++}`,
        tagName: tagMatch[1].toLowerCase(),
        attributes: parseAttributes(token),
        children: [],
        parent: stack.at(-1) ?? null,
      }

      stack.at(-1)?.children.push(element)

      if (!selfClosing) {
        stack.push(element)
      }

      continue
    }

    const normalizedText = token.replace(/\s+/g, ' ')
    if (!normalizedText.trim()) {
      continue
    }

    stack.at(-1)?.children.push({
      kind: 'text',
      text: normalizedText,
      parent: stack.at(-1) ?? null,
    })
  }

  return root
}

function parseAttributes(token: string) {
  const attributes: Record<string, string> = {}
  const attributePattern = /([^\s=/>]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

  let match = attributePattern.exec(token)
  while (match) {
    const [, name, doubleQuoted, singleQuoted, bare] = match
    if (!name.startsWith('<')) {
      attributes[name] = doubleQuoted ?? singleQuoted ?? bare ?? ''
    }
    match = attributePattern.exec(token)
  }

  delete attributes['/']
  return attributes
}

function getTextContent(node: ElementNode | TextNode): string {
  if (node.kind === 'text') {
    return node.text
  }

  return node.children.map(getTextContent).join(' ')
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function querySelectorAll(root: ElementNode, selector: string) {
  const parts = selector
    .trim()
    .split(/\s+/)
    .map(parseSelectorPart)

  let current = [root]
  for (const part of parts) {
    current = current.flatMap((node) => findDescendants(node, part))
  }

  return current
}

function parseSelectorPart(input: string): SimpleSelector {
  const match = /^(?:([a-z0-9-]+))?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/i.exec(input)
  if (!match) {
    throw new Error(`Unsupported selector: ${input}`)
  }

  return {
    tagName: match[1]?.toLowerCase(),
    attrName: match[2],
    attrValue: match[3],
  }
}

function findDescendants(root: ElementNode, selector: SimpleSelector): ElementNode[] {
  const matches: ElementNode[] = []

  for (const child of root.children) {
    if (child.kind !== 'element') {
      continue
    }

    if (matchesSelector(child, selector)) {
      matches.push(child)
    }

    matches.push(...findDescendants(child, selector))
  }

  return matches
}

function matchesSelector(node: ElementNode, selector: SimpleSelector) {
  if (selector.tagName && node.tagName !== selector.tagName) {
    return false
  }

  if (!selector.attrName) {
    return true
  }

  if (!(selector.attrName in node.attributes)) {
    return false
  }

  if (selector.attrValue === undefined) {
    return true
  }

  return node.attributes[selector.attrName] === selector.attrValue
}

function findControlByLabel(root: ElementNode, labelText: string) {
  const labels = querySelectorAll(root, 'label')
  const normalizedLabel = normalizeWhitespace(labelText)

  for (const label of labels) {
    if (normalizeWhitespace(getTextContent(label)) !== normalizedLabel) {
      continue
    }

    const targetId = label.attributes.for
    if (targetId) {
      const target = querySelectorAll(root, `[id="${targetId}"]`)[0]
      if (target) {
        return target
      }
    }

    const nestedControl = querySelectorAll(label, 'input')[0]
    if (nestedControl) {
      return nestedControl
    }
  }

  return null
}

function findByRole(root: ElementNode, role: RoleName, name?: string) {
  const matches: ElementNode[] = []
  const normalizedName = name ? normalizeWhitespace(name) : null

  for (const node of findAllElements(root)) {
    const inferredRole = getImplicitRole(node)
    if (inferredRole !== role) {
      continue
    }

    if (normalizedName && normalizeWhitespace(getAccessibleName(root, node)) !== normalizedName) {
      continue
    }

    matches.push(node)
  }

  return matches
}

function findAllElements(root: ElementNode): ElementNode[] {
  const matches: ElementNode[] = []

  for (const child of root.children) {
    if (child.kind !== 'element') {
      continue
    }

    matches.push(child)
    matches.push(...findAllElements(child))
  }

  return matches
}

function getImplicitRole(node: ElementNode): RoleName | null {
  if (node.tagName === 'button') {
    return 'button'
  }

  if (node.tagName === 'a') {
    return 'link'
  }

  if (/^h[1-6]$/.test(node.tagName)) {
    return 'heading'
  }

  return null
}

function getAccessibleName(root: ElementNode, node: ElementNode) {
  if (node.attributes['aria-label']) {
    return node.attributes['aria-label']
  }

  if (node.tagName === 'input') {
    const id = node.attributes.id
    if (id) {
      for (const label of querySelectorAll(root, 'label')) {
        if (label.attributes.for === id) {
          return getTextContent(label)
        }
      }
    }
  }

  return getTextContent(node)
}

function getControlName(node: ElementNode) {
  return node.attributes.name ?? node.attributes.id ?? null
}

function findAncestor(node: ElementNode, tagName: string): ElementNode | null {
  let current = node.parent
  while (current) {
    if (current.tagName === tagName) {
      return current
    }
    current = current.parent
  }
  return null
}
