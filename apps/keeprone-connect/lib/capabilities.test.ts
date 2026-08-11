import { describe, expect, it } from 'vitest'
import { parseExecutableConnectorCommand, parseStagePlan } from './capabilities'

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
})
