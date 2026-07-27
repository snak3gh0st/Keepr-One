import { describe, expect, it } from 'vitest'
import { assertBrowserJobTransition } from './job-state'

describe('browser job transitions', () => {
  it.each([
    ['QUEUED', 'RUNNING'],
    ['RUNNING', 'WAITING_FOR_MFA'],
    ['WAITING_FOR_MFA', 'QUEUED'],
    ['RUNNING', 'SUCCEEDED'],
    ['RUNNING', 'RETRYABLE'],
    ['RETRYABLE', 'QUEUED'],
    ['RUNNING', 'CREDENTIALS_EXPIRED'],
    ['RUNNING', 'MANUAL_REVIEW'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertBrowserJobTransition(from, to)).not.toThrow()
  })

  it('rejects retrying a succeeded job', () => {
    expect(() => assertBrowserJobTransition('SUCCEEDED', 'QUEUED')).toThrow(
      'Invalid browser job transition',
    )
  })
})
