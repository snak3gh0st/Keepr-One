import { describe, expect, it } from 'vitest'
import {
  isSafePolicyDetailPath,
  parseConnectorCommandDispatch,
  parseExecutableConnectorCommand,
  parseStagePlan,
  policyDetailNavigatePath,
} from './capabilities'

// READ_POLICY_DETAIL is the first per-entity capability: the navigate target is not
// one of the closed catalogue of static paths every other capability uses, it is one
// fixed page plus an opaque id the portal assigns per policy. The two functions below
// mirror `policyDetailNavigatePath` / `isSafePolicyDetailPath` in
// `lib/national-life/local-connector/capabilities.ts` on the server — intentionally a
// near-duplicate rather than a shared import, for the same reason `isSafeNavigatePath`
// is duplicated: this is a trust boundary, and each side validates independently.
describe('policyDetailNavigatePath / isSafePolicyDetailPath', () => {
  const VALID_ID = 'a73f1af893a94906b965e68d11db807b'

  it('builds the navigate path for a valid 32-hex id', () => {
    expect(policyDetailNavigatePath(VALID_ID)).toBe(
      `/agent/book-of-business/inforce-book/all-clients/policy-details?id=${VALID_ID}`,
    )
  })

  it('round-trips: every path it builds is accepted by the validator', () => {
    expect(isSafePolicyDetailPath(policyDetailNavigatePath(VALID_ID))).toBe(true)
  })

  it('rejects an id that is not exactly 32 lowercase hex characters', () => {
    expect(() => policyDetailNavigatePath('')).toThrow('UNSAFE_ENTITY_ID')
    expect(() => policyDetailNavigatePath(VALID_ID.slice(0, 31))).toThrow('UNSAFE_ENTITY_ID')
    expect(() => policyDetailNavigatePath(`${VALID_ID}f`)).toThrow('UNSAFE_ENTITY_ID')
    expect(() => policyDetailNavigatePath(VALID_ID.toUpperCase())).toThrow('UNSAFE_ENTITY_ID')
  })

  it('rejects any path other than exactly the known policy-details route', () => {
    expect(isSafePolicyDetailPath(`/agent/x?id=${VALID_ID}`)).toBe(false)
    expect(isSafePolicyDetailPath(
      `/agent/book-of-business/inforce-book/all-clients/client-information-details?id=${VALID_ID}`,
    )).toBe(false)
  })

  it('rejects a malformed or extra query string', () => {
    const base = '/agent/book-of-business/inforce-book/all-clients/policy-details'
    expect(isSafePolicyDetailPath(base)).toBe(false)
    expect(isSafePolicyDetailPath(`${base}?id=`)).toBe(false)
    expect(isSafePolicyDetailPath(`${base}?id=${VALID_ID}&next=/agent/x`)).toBe(false)
    expect(isSafePolicyDetailPath(`${base}?id=${VALID_ID}#frag`)).toBe(false)
  })

  it('rejects scheme smuggling and traversal in the id position', () => {
    const base = '/agent/book-of-business/inforce-book/all-clients/policy-details'
    expect(isSafePolicyDetailPath(`${base}?id=../../admin`)).toBe(false)
    expect(isSafePolicyDetailPath(`//evil.example${base}?id=${VALID_ID}`)).toBe(false)
  })
})

describe('parseStagePlan', () => {
  it('accepts a READ_GRID stage from the server', () => {
    const [stage] = parseStagePlan([
      {
        capability: 'READ_GRID',
        params: {
          gridKey: 'PAID_COMMISSIONS',
          navigatePath: '/agent/compensation/commissions/paid-commissions',
        },
      },
    ])
    expect(stage?.capability).toBe('READ_GRID')
    expect(stage?.capability === 'READ_GRID' ? stage.params.gridKey : null).toBe('PAID_COMMISSIONS')
    expect(stage?.params.navigatePath).toBe(
      '/agent/compensation/commissions/paid-commissions',
    )
  })

  it('accepts a READ_PAGE source from the server', () => {
    const [stage] = parseStagePlan([
      {
        capability: 'READ_PAGE',
        params: { sourceKey: 'AGENT_DASHBOARD', navigatePath: '/agent/' },
      },
    ])
    expect(stage).toEqual({
      capability: 'READ_PAGE',
      params: { sourceKey: 'AGENT_DASHBOARD', navigatePath: '/agent/' },
    })
  })

  it('accepts the explicit commission-detail mode', () => {
    const [stage] = parseStagePlan([{
      capability: 'READ_GRID',
      params: {
        gridKey: 'COMMISSIONS_EARNING_REPORT',
        navigatePath:
          '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
        mode: 'COMMISSION_DETAILS',
      },
    }])
    expect(stage).toMatchObject({
      capability: 'READ_GRID',
      params: { mode: 'COMMISSION_DETAILS' },
    })
  })

  it('accepts only the official in-force export with contact information', () => {
    expect(parseStagePlan([{
      capability: 'READ_EXPORT',
      params: {
        sourceKey: 'INFORCE_CLIENTS',
        navigatePath: '/agent/book-of-business/inforce-book/all-clients/all-clients-agent',
        includeContactInformation: true,
      },
    }])[0]).toMatchObject({ capability: 'READ_EXPORT' })
    expect(() => parseStagePlan([{
      capability: 'READ_EXPORT',
      params: { sourceKey: 'NEW_BUSINESS', navigatePath: '/agent/x', includeContactInformation: true },
    }])).toThrow('INVALID_RUN_RESPONSE')
  })

  it('accepts multiple stages up to the cap', () => {
    const plan = parseStagePlan(
      Array.from({ length: 64 }, (_, i) => ({
        capability: 'READ_GRID',
        params: { gridKey: `GRID_${i}`, navigatePath: '/agent/x' },
      })),
    )
    expect(plan).toHaveLength(64)
  })

  it('refuses a capability it does not implement', () => {
    expect(() =>
      parseStagePlan([{ capability: 'SUBMIT_APPLICATION', params: {} }]),
    ).toThrow('UNKNOWN_CAPABILITY')
  })

  it('refuses a path outside the agent tree', () => {
    const hostilePaths = [
      // From the brief.
      '/NWI/Main/Layout.aspx',
      'https://evil.example/agent/x',
      '//evil.example/agent/x',
      '/agent/../admin',
      '/agent/x?next=/y',
      // Additional attack attempts against isSafeNavigatePath.
      '/agent/x#frag',
      '/agent/x%2e%2e/y', // percent-encoded traversal
      '/agent/x\\..\\y', // backslash-as-separator traversal
      '/agent/․/y', // unicode one-dot-leader look-alike for '.'
      '/agent/x\u0000y', // embedded null byte
      '/agent/@evil.com/x', // embedded authority marker
      '/AGENT/x', // case mismatch on the required prefix
      'javascript:alert(1)', // scheme smuggling
      'https:/agent/x', // single-slash scheme smuggling
      '/agent%2f..%2fadmin', // percent-encoded slash hides the real prefix
      '/agent/x a', // whitespace
      '/agent/x\ty', // tab
      '/agent/./x', // dot-segment (not literal '..' but still a dot)
      '/agent/a⁄b', // unicode fraction slash look-alike
    ]
    for (const navigatePath of hostilePaths) {
      expect(() =>
        parseStagePlan([
          { capability: 'READ_GRID', params: { gridKey: 'X', navigatePath } },
        ]),
      ).toThrow('UNSAFE_NAVIGATE_PATH')
    }
  })

  it('refuses extra properties on the stage', () => {
    expect(() =>
      parseStagePlan([
        {
          capability: 'READ_GRID',
          params: { gridKey: 'X', navigatePath: '/agent/x' },
          extra: 1,
        },
      ]),
    ).toThrow()
  })

  it('refuses extra properties on params', () => {
    expect(() =>
      parseStagePlan([
        {
          capability: 'READ_GRID',
          params: { gridKey: 'X', navigatePath: '/agent/x', extra: 1 },
        },
      ]),
    ).toThrow()
  })

  it('refuses a non-array value', () => {
    expect(() => parseStagePlan({ capability: 'READ_GRID' })).toThrow(
      'INVALID_RUN_RESPONSE',
    )
  })

  it('refuses an empty plan', () => {
    expect(() => parseStagePlan([])).toThrow('INVALID_RUN_RESPONSE')
  })

  it('refuses a plan beyond the stage cap', () => {
    const stages = Array.from({ length: 65 }, () => ({
      capability: 'READ_GRID',
      params: { gridKey: 'X', navigatePath: '/agent/x' },
    }))
    expect(() => parseStagePlan(stages)).toThrow('INVALID_RUN_RESPONSE')
  })

  it('refuses a non-string gridKey', () => {
    expect(() =>
      parseStagePlan([
        { capability: 'READ_GRID', params: { gridKey: 123, navigatePath: '/agent/x' } },
      ]),
    ).toThrow('INVALID_RUN_RESPONSE')
  })

  it('refuses a gridKey that is too long', () => {
    expect(() =>
      parseStagePlan([
        {
          capability: 'READ_GRID',
          params: { gridKey: 'X'.repeat(65), navigatePath: '/agent/x' },
        },
      ]),
    ).toThrow('INVALID_RUN_RESPONSE')
  })

  it('refuses a gridKey outside the label charset', () => {
    for (const gridKey of ['new-business', 'NEW BUSINESS', 'NEW.BUSINESS', 'NEW/BUSINESS', '']) {
      expect(() =>
        parseStagePlan([
          { capability: 'READ_GRID', params: { gridKey, navigatePath: '/agent/x' } },
        ]),
      ).toThrow('INVALID_RUN_RESPONSE')
    }
  })

  it('refuses a navigatePath beyond the length cap', () => {
    expect(() =>
      parseStagePlan([
        {
          capability: 'READ_GRID',
          params: { gridKey: 'X', navigatePath: `/agent/${'x'.repeat(512)}` },
        },
      ]),
    ).toThrow('UNSAFE_NAVIGATE_PATH')
  })

  it('refuses a non-object entry', () => {
    expect(() => parseStagePlan(['READ_GRID'])).toThrow('INVALID_RUN_RESPONSE')
  })

  it('refuses a non-object params', () => {
    expect(() =>
      parseStagePlan([{ capability: 'READ_GRID', params: 'x' }]),
    ).toThrow('INVALID_RUN_RESPONSE')
  })
})

describe('parseExecutableConnectorCommand', () => {
  it('accepts only the value-free read/navigation-only iGO probe', () => {
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_igo_probe_1',
      runId: 'run_igo_probe_1',
      capability: 'OPEN_EAPP',
      target: null,
      params: {},
      idempotencyKey: 'igo-probe-1',
      issuedAt: '2026-08-26T20:00:00.000Z',
      expiresAt: '2026-08-26T20:30:00.000Z',
      requiresConfirmation: false,
    }
    expect(parseExecutableConnectorCommand(command)).toMatchObject({ capability: 'OPEN_EAPP' })
    expect(() => parseExecutableConnectorCommand({
      ...command,
      params: { applicationId: 'application_1' },
    })).toThrow('INVALID_COMMAND')
    expect(() => parseExecutableConnectorCommand({
      ...command,
      target: { kind: 'APPLICATION', id: 'application_1' },
    })).toThrow('INVALID_COMMAND')
  })

  it('accepts a confirmed illustration only with a sealed input hash', () => {
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_illustration_1',
      runId: 'run_illustration_1',
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'illustration_1' },
      params: { illustrationId: 'illustration_1', inputHash: 'a'.repeat(64) },
      idempotencyKey: 'illustration_1:generate:1',
      issuedAt: '2026-08-10T20:00:00.000Z',
      expiresAt: '2026-08-10T20:30:00.000Z',
      requiresConfirmation: true,
    }
    expect(parseExecutableConnectorCommand(command)).toMatchObject({
      capability: 'GENERATE_ILLUSTRATION',
    })
    expect(() => parseExecutableConnectorCommand({
      ...command,
      params: { illustrationId: 'illustration_1' },
    })).toThrow('INVALID_COMMAND')
  })

  it('accepts the current READ_GRID command and refuses an unshipped capability', () => {
    expect(() => parseExecutableConnectorCommand({
      protocolVersion: 1,
      commandId: 'cmd_1',
      runId: 'run_1',
      capability: 'READ_GRID',
      target: null,
      params: { gridKey: 'NEW_BUSINESS', navigatePath: '/agent/book-of-business/new-business/all-new-business-cases' },
      idempotencyKey: 'read-grid-1',
      issuedAt: '2026-08-10T20:00:00.000Z',
      expiresAt: '2026-08-10T20:30:00.000Z',
      requiresConfirmation: false,
    })).not.toThrow()

    expect(() => parseExecutableConnectorCommand({
      protocolVersion: 1,
      commandId: 'cmd_2',
      runId: 'run_2',
      capability: 'FORESIGHT_INVENTORY',
      target: null,
      params: {},
      idempotencyKey: 'foresight-1',
      issuedAt: '2026-08-10T20:00:00.000Z',
      expiresAt: '2026-08-10T20:30:00.000Z',
      requiresConfirmation: false,
    })).toThrow('UNKNOWN_CAPABILITY')
  })

  it('accepts only the exact READ_POLICY_DETAIL route authorized by the server', () => {
    const navigatePath = policyDetailNavigatePath('a73f1af893a94906b965e68d11db807b')
    const value = {
      protocolVersion: 1,
      commandId: 'cmd_policy_1',
      runId: 'run_policy_1',
      capability: 'READ_POLICY_DETAIL',
      target: { kind: 'POLICY', id: 'policy_1', carrierExternalId: 'LS1473219' },
      params: { policyNumber: 'LS1473219', navigatePath },
      idempotencyKey: 'policy_1:detail:1',
      issuedAt: '2026-08-10T20:00:00.000Z',
      expiresAt: '2026-08-10T20:30:00.000Z',
      requiresConfirmation: false,
    }

    expect(parseExecutableConnectorCommand(value)).toMatchObject({ capability: 'READ_POLICY_DETAIL' })
    expect(() => parseExecutableConnectorCommand({
      ...value,
      params: { ...value.params, navigatePath: `${navigatePath}&next=/agent/x` },
    })).toThrow('INVALID_COMMAND')
  })

  it('accepts only a bounded resumable dispatch cursor', () => {
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_policy_1',
      runId: 'run_policy_1',
      capability: 'READ_POLICY_DETAIL',
      target: { kind: 'POLICY', id: 'policy_1' },
      params: {
        policyNumber: 'LS1473219',
        navigatePath: policyDetailNavigatePath('a73f1af893a94906b965e68d11db807b'),
      },
      idempotencyKey: 'policy_1:detail:1',
      issuedAt: '2026-08-10T20:00:00.000Z',
      expiresAt: '2026-08-10T20:30:00.000Z',
      requiresConfirmation: false,
    }
    expect(parseConnectorCommandDispatch({
      command,
      state: 'RUNNING',
      nextEventSequence: 2,
      lastEventType: 'COMMAND_STARTED',
    })).toMatchObject({ state: 'RUNNING', nextEventSequence: 2 })
    expect(() => parseConnectorCommandDispatch({
      command, state: 'RUNNING', nextEventSequence: -1, lastEventType: null,
    })).toThrow('INVALID_COMMAND')
  })
})
