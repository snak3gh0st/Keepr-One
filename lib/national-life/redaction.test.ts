import { describe, expect, it } from 'vitest'
import { redactDiagnostic } from './redaction'

describe('redactDiagnostic', () => {
  it('recursively redacts secrets and sensitive identifiers', () => {
    expect(
      redactDiagnostic({
        username: 'agent@example.com',
        password: 'secret',
        authorization: 'Bearer token',
        cookie: 'session=x',
        applicantSsn: '111-22-3333',
        safeCode: 'SELECTOR_NOT_FOUND',
      }),
    ).toEqual({
      username: '[REDACTED]',
      password: '[REDACTED]',
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      applicantSsn: '[REDACTED]',
      safeCode: 'SELECTOR_NOT_FOUND',
    })
  })
})
