import { describe, expect, it } from 'vitest'
import { assertBrowserJobTransition } from './job-state'

describe('browser job transitions', () => {
  it.each([
    ['QUEUED', 'RUNNING'],
    ['RUNNING', 'ACTION_REQUIRED'],
    ['ACTION_REQUIRED', 'QUEUED'],
    ['RUNNING', 'SUCCEEDED'],
    ['RUNNING', 'RETRYABLE'],
    ['RETRYABLE', 'QUEUED'],
    ['RUNNING', 'MANUAL_REVIEW'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertBrowserJobTransition(from, to)).not.toThrow()
  })

  it('rejects retrying a succeeded job', () => {
    expect(() => assertBrowserJobTransition('SUCCEEDED', 'QUEUED')).toThrow(
      'Invalid browser job transition',
    )
  })

  it.each(['WAITING_FOR_MFA', 'CREDENTIALS_EXPIRED'] as const)(
    'rejects the removed password-era RUNNING -> %s path',
    (state) => {
      expect(() => assertBrowserJobTransition('RUNNING', state)).toThrow(
        'Invalid browser job transition',
      )
    },
  )
})
