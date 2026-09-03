import { isSafePolicyDetailPath } from './capabilities'

function compact(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

function exactPolicyDetailPath(document: Document, expectedPolicyNumber: string): string | null {
  const expected = compact(expectedPolicyNumber)
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (compact(anchor.textContent ?? '') !== expected) continue
    const path = anchor.getAttribute('href')?.trim() ?? ''
    if (isSafePolicyDetailPath(path)) return path
  }
  return null
}

function searchControls(document: Document): {
  input: HTMLInputElement
  submit: HTMLButtonElement
} | null {
  const input = document.querySelector('#Enter_Keywords')
  const form = input?.closest('form')
  const submit = form?.querySelector('button[type="submit"]')
  const view = document.defaultView
  if (
    !view ||
    !(input instanceof view.HTMLInputElement) ||
    !(submit instanceof view.HTMLButtonElement)
  ) return null
  return { input, submit }
}

export async function locateCurrentPolicyDetailPath(
  document: Document,
  expectedPolicyNumber: string,
  timeoutMs = 10_000,
): Promise<string> {
  const alreadyVisible = exactPolicyDetailPath(document, expectedPolicyNumber)
  if (alreadyVisible) return alreadyVisible

  const controls = searchControls(document)
  if (!controls) throw new Error('POLICY_DETAIL_LOOKUP_UNAVAILABLE')
  const EventConstructor = document.defaultView?.Event
  if (!EventConstructor) throw new Error('POLICY_DETAIL_LOOKUP_UNAVAILABLE')

  controls.input.value = expectedPolicyNumber
  controls.input.dispatchEvent(new EventConstructor('input', { bubbles: true }))
  controls.input.dispatchEvent(new EventConstructor('change', { bubbles: true }))
  controls.submit.click()

  const deadline = Date.now() + timeoutMs
  do {
    const located = exactPolicyDetailPath(document, expectedPolicyNumber)
    if (located) return located
    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  throw new Error('POLICY_DETAIL_NOT_FOUND')
}
