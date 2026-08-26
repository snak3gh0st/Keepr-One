import { describe, expect, it, vi } from 'vitest'
import { createFlexLifeQuoteStatusRepository } from './flexlife-quote-status'

function repository(command: Record<string, unknown> | null, illustration: Record<string, unknown> | null = null) {
  return createFlexLifeQuoteStatusRepository({
    nationalLifeConnectorCommand: { findFirst: vi.fn().mockResolvedValue(command) },
    illustration: { findFirst: vi.fn().mockResolvedValue(illustration) },
  } as never)
}

describe('local FlexLife quote status', () => {
  it('keeps queued work pending and exposes authentication without calling it a failure', async () => {
    await expect(repository({
      id: 'cmd-1', capability: 'FLEXLIFE_QUOTE', state: 'QUEUED', target: { kind: 'ILLUSTRATION', id: 'ill-1' },
      safeErrorCode: null,
    }).getOwnedQuoteStatus('agent-1', 'cmd-1')).resolves.toEqual({ state: 'PENDING' })
    await expect(repository({
      id: 'cmd-1', capability: 'FLEXLIFE_QUOTE', state: 'AUTH_REQUIRED', target: { kind: 'ILLUSTRATION', id: 'ill-1' },
      safeErrorCode: null,
    }).getOwnedQuoteStatus('agent-1', 'cmd-1')).resolves.toEqual({ state: 'AUTH_REQUIRED' })
  })

  it('returns the persisted carrier answer only for the owned target', async () => {
    const quote = {
      ok: true, faceAmount: 250000, annualPremium: 5100, monthlyPremium: 425, lapseYear: 'NEVER',
    }
    await expect(repository({
      id: 'cmd-1', capability: 'FLEXLIFE_QUOTE', state: 'COMPLETED', target: { kind: 'ILLUSTRATION', id: 'ill-1' },
      safeErrorCode: null,
    }, { rawPayload: { request: {}, response: quote } })
      .getOwnedQuoteStatus('agent-1', 'cmd-1')).resolves.toEqual({ state: 'ANSWERED', quote })
  })

  it('maps failed work and malformed completed data without inventing a quote', async () => {
    await expect(repository({
      id: 'cmd-1', capability: 'FLEXLIFE_QUOTE', state: 'FAILED', target: { kind: 'ILLUSTRATION', id: 'ill-1' },
      safeErrorCode: 'PORTAL_REQUEST_FAILED',
    }).getOwnedQuoteStatus('agent-1', 'cmd-1')).resolves.toEqual({
      state: 'UNAVAILABLE', safeErrorCode: 'PORTAL_REQUEST_FAILED',
    })
    await expect(repository({
      id: 'cmd-1', capability: 'FLEXLIFE_QUOTE', state: 'COMPLETED', target: { kind: 'ILLUSTRATION', id: 'ill-1' },
      safeErrorCode: null,
    }, { rawPayload: { response: { ok: true, faceAmount: 'fake' } } })
      .getOwnedQuoteStatus('agent-1', 'cmd-1')).resolves.toEqual({
      state: 'UNAVAILABLE', safeErrorCode: 'QUOTE_RESULT_MISSING',
    })
  })
})
