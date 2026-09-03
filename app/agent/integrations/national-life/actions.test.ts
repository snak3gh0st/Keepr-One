import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  requireAgentModule: vi.fn(),
  headers: vi.fn(),
  start: vi.fn(),
  bootstrap: vi.fn(),
  cancel: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/require-agent-module', () => ({
  requireAgentModule: mocks.requireAgentModule,
}))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({
    language: 'EN',
    copy: (_pt: string, en: string, values: Record<string, string | number> = {}) =>
      en.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`)),
  }),
}))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/national-life/interactive-connection-service', () => ({
  startConnectionAttempt: mocks.start,
  issueViewerBootstrap: mocks.bootstrap,
  cancelConnectionAttempt: mocks.cancel,
  disconnectAgentSession: mocks.disconnect,
}))

import {
  cancelNationalLifeConnection,
  createNationalLifeViewerBootstrap,
  disconnectNationalLifeConnection,
  startNationalLifeConnection,
} from './actions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(new Headers({
    origin: 'https://app.keepr.one',
    host: 'app.keepr.one',
    'x-forwarded-proto': 'https',
  }))
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.requireAgentModule.mockResolvedValue({ user: { role: 'AGENT' } })
})

describe('National Life interactive connection actions', () => {
  it('fails anonymous and client users through getCurrentAgent', async () => {
    mocks.getCurrentAgent.mockRejectedValue(new Error('Forbidden'))
    await expect(startNationalLifeConnection()).resolves.toEqual({
      ok: false,
      message: 'We could not start your National Life connection right now. Please try again.',
    })
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('returns only safe attempt identity, state, and expiry', async () => {
    mocks.start.mockResolvedValue({
      kind: 'STARTED',
      attempt: {
        id: 'attempt-1',
        state: 'OPENING_PORTAL',
        currentOrigin: null,
        safeErrorCode: null,
        expiresAt: new Date('2026-07-28T12:10:00.000Z'),
      },
    })
    await expect(startNationalLifeConnection()).resolves.toEqual({
      ok: true,
      attemptId: 'attempt-1',
      state: 'OPENING_PORTAL',
      expiresAt: '2026-07-28T12:10:00.000Z',
    })
    expect(mocks.requireAgentModule).toHaveBeenCalledWith('INTEGRATIONS')
  })

  it('requires an owned interactive attempt for viewer bootstrap', async () => {
    mocks.bootstrap.mockRejectedValue(new Error('not found'))
    await expect(createNationalLifeViewerBootstrap('attempt-other')).resolves.toEqual({
      ok: false,
      message: 'This secure session is no longer available. Start a new connection.',
    })
    expect(mocks.bootstrap).toHaveBeenCalledWith({
      agentId: 'agent-1',
      attemptId: 'attempt-other',
    })
  })

  it('scopes cancel and disconnect to the current agent', async () => {
    await cancelNationalLifeConnection('attempt-1')
    await disconnectNationalLifeConnection()
    expect(mocks.cancel).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
      attemptId: 'attempt-1',
    })
    expect(mocks.disconnect).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
    })
  })

  it('accepts no FormData, credential, cookie, token, or arbitrary URL fields', async () => {
    const source = await readFile(new URL('./actions.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/FormData|username|password|cookie|arbitraryUrl|SAVE_CONNECTION_SCHEMA/)
    expect(startNationalLifeConnection.length).toBe(0)
    expect(disconnectNationalLifeConnection.length).toBe(0)
    expect(createNationalLifeViewerBootstrap.length).toBe(1)
    expect(cancelNationalLifeConnection.length).toBe(1)
  })
})
