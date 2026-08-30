import { describe, expect, it } from 'vitest'
import { validateApplicationDocument } from './document-service'

describe('Application document validation', () => {
  it('accepts a bounded PDF and returns its hash', () => {
    const result = validateApplicationDocument({
      type: 'IDENTITY',
      filename: 'driver-license.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(result.filename).toBe('driver-license.pdf')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('sanitizes the filename without accepting a path', () => {
    expect(validateApplicationDocument({
      type: 'AUTHORIZATION',
      filename: '../../client authorization.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([1]),
    }).filename).toBe('client_authorization.pdf')
  })

  it('rejects executable content types, empty files, and oversized files', () => {
    expect(() => validateApplicationDocument({
      type: 'OTHER', filename: 'x.html', mimeType: 'text/html', bytes: new Uint8Array([1]),
    })).toThrow('APPLICATION_DOCUMENT_TYPE_NOT_ALLOWED')
    expect(() => validateApplicationDocument({
      type: 'OTHER', filename: 'x.pdf', mimeType: 'application/pdf', bytes: new Uint8Array(),
    })).toThrow('APPLICATION_DOCUMENT_EMPTY')
    expect(() => validateApplicationDocument({
      type: 'OTHER', filename: 'x.pdf', mimeType: 'application/pdf',
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
    })).toThrow('APPLICATION_DOCUMENT_TOO_LARGE')
  })
})
