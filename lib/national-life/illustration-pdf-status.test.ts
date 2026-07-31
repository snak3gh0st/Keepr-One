import { describe, expect, it } from 'vitest'
import {
  illustrationPdfMessage,
  latestPdfStatusByIllustration,
} from './illustration-pdf-status'
import type { BrowserJobRecord } from './job-service'

function job(patch: Partial<BrowserJobRecord>): BrowserJobRecord {
  return {
    id: 'job-1',
    agentId: 'agent-1',
    caseId: null,
    provider: 'NATIONAL_LIFE',
    operation: 'GENERATE_ILLUSTRATION_PDF',
    state: 'FAILED',
    idempotencyKey: 'k',
    input: { illustrationId: 'ill-1' },
    result: null,
    safeErrorCode: null,
    safeErrorDetail: null,
    attemptCount: 1,
    availableAt: new Date('2026-07-31T15:00:00Z'),
    leaseOwner: null,
    leaseExpiresAt: null,
    ...patch,
  } as BrowserJobRecord
}

describe('latestPdfStatusByIllustration', () => {
  it('reports a queued render as still working', () => {
    expect(latestPdfStatusByIllustration([job({ state: 'QUEUED' })]).get('ill-1')).toEqual({
      state: 'WORKING',
    })
  })

  // The worker will pick it up again on its own. Calling that a failure sends
  // the agent to press a button the queue is about to press for them.
  it('treats a retryable render as still working', () => {
    expect(latestPdfStatusByIllustration([job({ state: 'RETRYABLE' })]).get('ill-1')).toEqual({
      state: 'WORKING',
    })
  })

  it('carries the failure code through, since that is what names the fix', () => {
    const status = latestPdfStatusByIllustration([
      job({ state: 'FAILED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' }),
    ])
    expect(status.get('ill-1')).toEqual({
      state: 'FAILED',
      safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
    })
  })

  // Asking again after a failure is the normal recovery, so the newest attempt
  // has to win — otherwise the row keeps showing yesterday's error while the
  // carrier is rendering right now.
  it('keeps only the newest attempt per illustration', () => {
    const status = latestPdfStatusByIllustration([
      job({ id: 'new', state: 'RUNNING' }),
      job({ id: 'old', state: 'FAILED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' }),
    ])
    expect(status.get('ill-1')).toEqual({ state: 'WORKING' })
  })

  // The row already shows the PDF link in that case; a second signal saying
  // "pronto" next to it would be noise.
  it('says nothing about a render that succeeded', () => {
    expect(latestPdfStatusByIllustration([job({ state: 'SUCCEEDED' })]).size).toBe(0)
  })

  it('ignores jobs whose input carries no illustration', () => {
    expect(latestPdfStatusByIllustration([job({ input: {} as never })]).size).toBe(0)
  })
})

describe('illustrationPdfMessage', () => {
  // The measured failure of 2026-07-31 15:38 UTC. Nothing is wrong with the
  // quote — the carrier's tool wants a login — and the sentence has to say so,
  // or the agent goes looking in the wrong place.
  it('turns the expired carrier login into an instruction, not an error', () => {
    expect(
      illustrationPdfMessage({ state: 'FAILED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' }),
    ).toBe('A seguradora pediu login novo. Reconecte a integração e peça de novo.')
  })

  it('shows an unmapped code rather than swallowing it', () => {
    expect(illustrationPdfMessage({ state: 'FAILED', safeErrorCode: 'WAT' })).toBe(
      'Não foi possível gerar (WAT).',
    )
  })

  it('does not print an empty parenthesis when there is no code', () => {
    expect(illustrationPdfMessage({ state: 'FAILED', safeErrorCode: null })).toBe(
      'Não foi possível gerar.',
    )
  })

  it('says the render is under way while it is', () => {
    expect(illustrationPdfMessage({ state: 'WORKING' })).toBe('Gerando na seguradora…')
  })
})
