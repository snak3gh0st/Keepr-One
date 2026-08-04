import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startNationalLifeFixtureServer } from '../../scripts/national-life-fixture-server'
import { createFakeBrowserSession } from '../../tests/national-life/fake-browser'
import { NationalLifeAdapter } from './adapter'
import { FORESIGHT_READ_SERVICES } from '../../lib/national-life/foresight-sync'
import type { BrowserSession } from './types'

type FixtureServer = Awaited<ReturnType<typeof startNationalLifeFixtureServer>>

describe('National Life deterministic adapter', () => {
  let fixtureServer: FixtureServer

  beforeAll(async () => {
    fixtureServer = await startNationalLifeFixtureServer()
  })

  afterAll(async () => {
    await fixtureServer.close()
  })

  it('classifies the carrier-owned login page without reading credentials', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    await session.page.goto(`${fixtureServer.origin}/login`)
    await expect(adapter.classifyAuthenticationState()).resolves.toEqual({
      kind: 'AWAITING_LOGIN',
      origin: fixtureServer.origin,
    })
  })

  it('classifies the carrier-owned MFA page without bypassing it', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    await session.page.goto(`${fixtureServer.origin}/mfa`)
    await expect(adapter.classifyAuthenticationState()).resolves.toEqual({
      kind: 'AWAITING_MFA',
      origin: fixtureServer.origin,
    })
  })

  it('classifies a deterministic authenticated carrier page', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    await session.page.goto(`${fixtureServer.origin}/cases/search`)
    await expect(adapter.classifyAuthenticationState()).resolves.toEqual({
      kind: 'AUTHENTICATED',
      origin: fixtureServer.origin,
    })
    await expect(adapter.assertAuthenticated()).resolves.toBeUndefined()
  })

  it('keeps the real Auth0 page open while the agent completes login or MFA', async () => {
    const locator = vi.fn(() => ({ count: vi.fn(async () => 0) }))
    const session = {
      page: {
        url: () => 'https://nlg-prod.auth0.com/login',
        locator,
      },
    } as unknown as BrowserSession
    const adapter = createProductionAdapter(session)

    await expect(adapter.classifyAuthenticationState()).resolves.toEqual({
      kind: 'AWAITING_LOGIN',
      origin: 'https://nlg-prod.auth0.com',
    })
  })

  it('waits through the National Life callback before accepting the agent portal', async () => {
    let currentUrl = 'https://www.nationallife.com/agent/auth/logincallback'
    const locator = vi.fn(() => ({ count: vi.fn(async () => 0) }))
    const session = {
      page: {
        url: () => currentUrl,
        locator,
      },
    } as unknown as BrowserSession
    const adapter = createProductionAdapter(session)

    await expect(adapter.classifyAuthenticationState()).resolves.toEqual({
      kind: 'AWAITING_LOGIN',
      origin: 'https://www.nationallife.com',
    })

    currentUrl = 'https://www.nationallife.com/agent/'
    await expect(adapter.classifyAuthenticationState()).resolves.toEqual({
      kind: 'AUTHENTICATED',
      origin: 'https://www.nationallife.com',
    })
  })

  it('rejects a non-allowlisted current origin before reading page markers', async () => {
    const locator = vi.fn(() => ({ count: vi.fn(async () => 1) }))
    const session = {
      page: { url: () => 'https://agent.nationallife.example.evil.test/login', locator },
    } as unknown as BrowserSession
    const adapter = createAdapter(session, 'https://agent.nationallife.example')

    await expect(adapter.classifyAuthenticationState()).rejects.toMatchObject({
      code: 'NAVIGATION_ORIGIN_BLOCKED',
    })
    expect(locator).not.toHaveBeenCalled()
  })

  it('rejects unknown pages on an allowlisted origin as portal layout changes', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    await session.page.goto(`${fixtureServer.origin}/login/failed`)
    await expect(adapter.classifyAuthenticationState()).rejects.toMatchObject({
      code: 'PORTAL_LAYOUT_CHANGED',
    })
  })

  it('contains no credential-fill implementation or credential type import', async () => {
    const source = await readFile(new URL('./adapter.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('.fill(credentials')
    expect(source).not.toContain('NationalLifeCredentials')
  })

  it('searches by external application id and normalizes a case observation', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)
    await session.page.goto(`${fixtureServer.origin}/cases/search`)

    await expect(
      adapter.readCase({ kind: 'EXTERNAL_ID', value: 'NLG-TEST-1001' }),
    ).resolves.toMatchObject({
      externalApplicationId: 'NLG-TEST-1001',
      carrierStatus: 'Underwriting',
      requirements: [
        {
          externalId: 'REQ-1',
          title: 'Attending Physician Statement',
          carrierStatus: 'Outstanding',
          dueAt: '2026-08-15',
        },
      ],
      communications: [],
      documents: [],
    })
  })

  it('rejects an unexpected application identifier', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)
    await session.page.goto(`${fixtureServer.origin}/cases/search`)

    await expect(
      adapter.readCase({ kind: 'EXTERNAL_ID', value: 'NLG-TEST-UNEXPECTED' }),
    ).rejects.toMatchObject({
      code: 'UNEXPECTED_APPLICATION_IDENTIFIER',
    })
  })

  it('returns a typed selector failure for the changed layout', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)
    await session.page.goto(`${fixtureServer.origin}/cases/search`)

    await expect(
      adapter.readCase({ kind: 'EXTERNAL_ID', value: 'NLG-TEST-CHANGED' }),
    ).rejects.toMatchObject({
      code: 'PORTAL_LAYOUT_CHANGED',
    })
  })

  it('performs no POST, PUT, PATCH or DELETE while reading cases', async () => {
    const { session, requests } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)
    await session.page.goto(`${fixtureServer.origin}/cases/search`)

    await adapter.readCase({ kind: 'EXTERNAL_ID', value: 'NLG-TEST-1001' })

    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('reads the Foresight inventory without opening a case or calling a service', async () => {
    const fixture = createForesightSession()
    const adapter = createAdapter(fixture.session, fixture.origin)

    await expect(adapter.readForesight({})).resolves.toEqual({
      cases: [
        {
          externalKey: 'RP-Silva-QQ-08032026',
          displayName: 'RP-Silva-QQ-08032026',
          caseKind: 'QUICK_QUOTE',
          product: null,
        },
        {
          externalKey: 'Maria Silva',
          displayName: 'Maria Silva',
          caseKind: 'CASE',
          product: null,
        },
      ],
      selectedCase: null,
      services: [],
    })
    expect(fixture.clickedCaseIds).toEqual([])
    expect(fixture.serviceCalls).toEqual([])
    expect(fixture.navigations).toEqual(['/agent/', '/agent/sso/foresight'])
  })

  it('reads only the selected Foresight case through the five allowlisted services in order', async () => {
    const fixture = createForesightSession()
    const adapter = createAdapter(fixture.session, fixture.origin)

    const result = await adapter.readForesight({ targetCaseKey: 'Maria Silva' })

    expect(result.selectedCase).toEqual({
      externalKey: 'Maria Silva',
      displayName: 'Maria Silva',
      caseKind: 'CASE',
      product: 'IUL',
    })
    expect(result.services).toHaveLength(5)
    expect(result.services[0]).toEqual({
      serviceName: 'WidgetService.asmx/GetQuickCalcData',
      payloadShape: { premium: 'number', email: 'string(20)', ProductName: 'string(3)' },
      payload: { premium: 250, email: '[REDACTED]', ProductName: 'IUL' },
      validationState: 'VALID',
    })
    expect(fixture.clickedCaseIds).toEqual(['lnkCaseName1'])
    expect(fixture.serviceCalls).toEqual(FORESIGHT_READ_SERVICES)
    expect(fixture.serviceCalls).not.toContain('PageService.asmx/RenderReports')
    expect(fixture.serviceCalls).not.toContain('PageService.asmx/IllustrateCase')
  })

  it('rejects a missing Foresight case without opening any listed case', async () => {
    const fixture = createForesightSession()
    const adapter = createAdapter(fixture.session, fixture.origin)

    await expect(adapter.readForesight({ targetCaseKey: 'Not in Recent' })).rejects.toMatchObject({
      code: 'FORESIGHT_CASE_NOT_FOUND',
    })
    expect(fixture.clickedCaseIds).toEqual([])
    expect(fixture.serviceCalls).toEqual([])
  })

  it('rejects an ambiguous Foresight detail key without opening either duplicate case', async () => {
    const fixture = createForesightSession({
      caseNames: ['RP-Silva-QQ-08032026', 'Maria Silva', 'Maria Silva'],
    })
    const adapter = createAdapter(fixture.session, fixture.origin)

    await expect(adapter.readForesight({ targetCaseKey: 'Maria Silva' })).rejects.toMatchObject({
      code: 'FORESIGHT_CASE_AMBIGUOUS',
    })
    expect(fixture.clickedCaseIds).toEqual([])
    expect(fixture.serviceCalls).toEqual([])
  })

  it('rejects an ambiguous legacy Foresight report fragment without selecting a case', async () => {
    const fixture = createForesightSession({ caseNames: ['Maria Silva', 'Maria Santos'] })
    const adapter = createAdapter(fixture.session, fixture.origin)

    await expect(adapter.renderForesightReport('Maria')).rejects.toMatchObject({
      code: 'FORESIGHT_CASE_AMBIGUOUS',
    })
    expect(fixture.clickedCaseIds).toEqual([])
  })

  it('omits query and fragment material from portal layout diagnostics', async () => {
    const fixture = createForesightSession({
      missingStartPage: true,
      layoutUrl: 'https://carrier.example.test/NWI/Main/Start.aspx?session=secret-value#oauth-fragment',
    })
    const adapter = createAdapter(fixture.session, fixture.origin)

    const error = await adapter.readForesight({}).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toMatchObject({
      code: 'PORTAL_LAYOUT_CHANGED',
      safeDetail: { portalUrl: 'https://carrier.example.test/NWI/Main/Start.aspx' },
    })
    expect(JSON.stringify((error as { safeDetail?: unknown }).safeDetail)).not.toContain('secret-value')
    expect(JSON.stringify((error as { safeDetail?: unknown }).safeDetail)).not.toContain('oauth-fragment')
  })

  it('classifies an Auth0 Foresight handoff before reading a frame or case', async () => {
    const fixture = createForesightSession({ auth0AfterSso: true })
    const adapter = createAdapter(fixture.session, fixture.origin)

    await expect(adapter.readForesight({})).rejects.toMatchObject({
      code: 'FORESIGHT_SSO_EXPIRED',
    })
    expect(fixture.startPageReads).toBe(0)
    expect(fixture.clickedCaseIds).toEqual([])
    expect(fixture.serviceCalls).toEqual([])
  })
})

function createForesightSession(options: {
  auth0AfterSso?: boolean
  caseNames?: string[]
  missingStartPage?: boolean
  layoutUrl?: string
} = {}) {
  const origin = 'https://carrier.example.test'
  const navigations: string[] = []
  const clickedCaseIds: string[] = []
  const serviceCalls: string[] = []
  const anchors = (options.caseNames ?? ['RP-Silva-QQ-08032026', 'Maria Silva']).map(
    (name, index) => ({
      id: `lnkCaseName${index}`,
      name,
      html: `<a id="lnkCaseName${index}">${name}</a>`,
    }),
  )
  let currentUrl = `${origin}/agent/`
  let startPageReads = 0
  let selectedCaseId: string | null = null
  let runtimeGeneration = 0

  const outerFrame = {
    url: () => `${origin}/agent/sso/foresight`,
    click: vi.fn(),
    evaluate: vi.fn(async () => null),
  }
  const startPage = {
    url: () => `${origin}/NWI/Main/StartPage.aspx`,
    async click(selector: string) {
      const matched = /^\[id="([^"]+)"\]$/.exec(selector)
      if (!matched || !anchors.some((anchor) => anchor.id === matched[1])) {
        throw new Error(`Unknown Foresight case selector: ${selector}`)
      }
      selectedCaseId = matched[1]
      clickedCaseIds.push(selectedCaseId)
      runtimeGeneration += 1
    },
    async evaluate<Result>(fn: unknown) {
      startPageReads += 1
      const source = String(fn)
      if (source.includes('outerHTML')) {
        return anchors.map(({ id, html }) => ({ id, html })) as Result
      }
      if (source.includes('lnkCaseName')) {
        return anchors.map(({ id, name }) => ({ id, name })) as Result
      }
      return null as Result
    },
  }
  const runtimeFrame = () => {
    const frameGeneration = runtimeGeneration
    return {
      url: () => `${origin}/NWI/Main/Case.aspx?generation=${frameGeneration}`,
      click: vi.fn(),
      async evaluate<Result, Arg>(fn: unknown, arg?: Arg) {
        if (frameGeneration !== runtimeGeneration) {
          throw new Error('WebForms replaced the Foresight runtime frame')
        }

        const source = String(fn)
        if (source.includes('$ITCommon')) {
          return (selectedCaseId ? `session-${frameGeneration}` : null) as Result
        }

        const [token, service] = arg as unknown as readonly [string, string]
        if (!token || !FORESIGHT_READ_SERVICES.includes(service as never)) {
          throw new Error(`Unexpected Foresight service: ${service}`)
        }
        serviceCalls.push(service)
        runtimeGeneration += 1
        return {
          premium: 250,
          email: 'insured@example.test',
          ProductName: 'IUL',
        } as Result
      },
    }
  }
  const page = {
    async goto(url: string) {
      const parsed = new URL(url)
      navigations.push(parsed.pathname)
      currentUrl =
        options.auth0AfterSso && parsed.pathname === '/agent/sso/foresight'
          ? 'https://nlg-prod.auth0.com/login'
          : options.layoutUrl && parsed.pathname === '/agent/sso/foresight'
            ? options.layoutUrl
            : parsed.toString()
    },
    url: () => currentUrl,
    async waitForTimeout() {},
    frames() {
      return options.auth0AfterSso || options.missingStartPage
        ? [outerFrame]
        : [outerFrame, startPage, runtimeFrame()]
    },
  }

  return {
    origin,
    navigations,
    clickedCaseIds,
    serviceCalls,
    get startPageReads() {
      return startPageReads
    },
    session: { page } as unknown as BrowserSession,
  }
}

function createAdapter(
  session: BrowserSession,
  origin: string,
) {
  return new NationalLifeAdapter(session, {
    carrierId: 'NATIONAL_LIFE',
    loginUrl: `${origin}/login`,
    caseSearchUrl: `${origin}/cases/search`,
    allowedOrigins: [origin],
    now: () => new Date('2026-07-27T12:34:56.000Z'),
  })
}

function createProductionAdapter(session: BrowserSession) {
  return new NationalLifeAdapter(session, {
    carrierId: 'NATIONAL_LIFE',
    loginUrl:
      'https://www.nationallife.com/agent/auth/login?returnUrl=%2Fagent%2F',
    caseSearchUrl: 'https://www.nationallife.com/cases/search',
    allowedOrigins: [
      'https://www.nationallife.com',
      'https://nlg-prod.auth0.com',
    ],
  })
}
