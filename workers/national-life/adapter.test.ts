import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startNationalLifeFixtureServer } from '../../scripts/national-life-fixture-server'
import { createFakeBrowserSession } from '../../tests/national-life/fake-browser'
import { NationalLifeAdapter } from './adapter'
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
})

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
