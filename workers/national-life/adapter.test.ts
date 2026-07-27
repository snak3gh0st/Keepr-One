import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startNationalLifeFixtureServer } from '../../scripts/national-life-fixture-server'
import { createFakeBrowserSession } from '../../tests/national-life/fake-browser'
import { NationalLifeAdapter } from './adapter'

type FixtureServer = Awaited<ReturnType<typeof startNationalLifeFixtureServer>>

describe('National Life deterministic adapter', () => {
  let fixtureServer: FixtureServer

  beforeAll(async () => {
    fixtureServer = await startNationalLifeFixtureServer()
  })

  afterAll(async () => {
    await fixtureServer.close()
  })

  it('authenticates and returns CONNECTED without exposing credentials', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    const result = await adapter.login({
      username: 'producer-100',
      password: 'invented-secret',
    })

    expect(result).toEqual({ kind: 'CONNECTED' })
    expect(JSON.stringify(result)).not.toContain('invented-secret')
  })

  it('returns MFA_REQUIRED without bypassing the challenge', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    await expect(
      adapter.login({
        username: 'mfa-producer',
        password: 'invented-secret',
      }),
    ).resolves.toEqual({
      kind: 'MFA_REQUIRED',
      resumeHint: 'Complete the National Life MFA challenge and resume this session.',
    })
  })

  it('rejects remote or lookalike fixture origins before fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(
      createFakeBrowserSession({
        baseUrl: 'http://127.0.0.1.evil.test:4173',
        startPath: '/login',
      }),
    ).rejects.toMatchObject({
      code: 'FIXTURE_ORIGIN_INVALID',
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('rejects fixture origins with extra path, query, hash, or userinfo before fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const invalidOrigins = [
      'http://127.0.0.1:4173/login',
      'http://127.0.0.1:4173?fixture=1',
      'http://user:pass@127.0.0.1:4173',
      'http://127.0.0.1:4173/#debug',
    ]

    for (const baseUrl of invalidOrigins) {
      await expect(
        createFakeBrowserSession({
          baseUrl,
          startPath: '/login',
        }),
      ).rejects.toMatchObject({
        code: 'FIXTURE_ORIGIN_INVALID',
      })
    }

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('rejects branded post-login pages that do not prove an authenticated portal state', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    await expect(
      adapter.login({
        username: 'denied-producer',
        password: 'invented-secret',
      }),
    ).rejects.toMatchObject({
      code: 'AUTHENTICATION_STATE_INVALID',
    })
  })

  it('searches by external application id and normalizes a case observation', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    await adapter.login({
      username: 'producer-100',
      password: 'invented-secret',
    })

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

    await adapter.login({
      username: 'producer-100',
      password: 'invented-secret',
    })

    await expect(
      adapter.readCase({ kind: 'EXTERNAL_ID', value: 'NLG-TEST-UNEXPECTED' }),
    ).rejects.toMatchObject({
      code: 'UNEXPECTED_APPLICATION_IDENTIFIER',
    })
  })

  it('returns a typed selector failure for the changed layout', async () => {
    const { session } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    await adapter.login({
      username: 'producer-100',
      password: 'invented-secret',
    })

    await expect(
      adapter.readCase({ kind: 'EXTERNAL_ID', value: 'NLG-TEST-CHANGED' }),
    ).rejects.toMatchObject({
      code: 'PORTAL_LAYOUT_CHANGED',
    })
  })

  it('performs no POST, PUT, PATCH or DELETE after login', async () => {
    const { session, requests } = await createFakeBrowserSession({ baseUrl: fixtureServer.origin })
    const adapter = createAdapter(session, fixtureServer.origin)

    await adapter.login({
      username: 'producer-100',
      password: 'invented-secret',
    })

    await adapter.readCase({ kind: 'EXTERNAL_ID', value: 'NLG-TEST-1001' })

    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)

    const followUpMethods = requests.slice(2).map((request) => request.method)
    expect(followUpMethods).toEqual(['GET', 'GET', 'GET', 'GET'])
  })
})

function createAdapter(session: Awaited<ReturnType<typeof createFakeBrowserSession>>['session'], origin: string) {
  return new NationalLifeAdapter(session, {
    carrierId: 'NATIONAL_LIFE',
    loginUrl: `${origin}/login`,
    caseSearchUrl: `${origin}/cases/search`,
    now: () => new Date('2026-07-27T12:34:56.000Z'),
  })
}
