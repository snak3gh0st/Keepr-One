import { describe, expect, it } from 'vitest'
import {
  illustrationDocumentFilename,
  isPdfPayload,
  reportReadiness,
} from './foresight-report'

describe('reportReadiness', () => {
  it('calls the measured 0.99 ready, because the PDF was already being served there', () => {
    expect(reportReadiness({ Progress: 0.99, IsComplete: false, HasException: false })).toBe(
      'READY',
    )
  })

  it('waits while the render is genuinely early', () => {
    expect(reportReadiness({ Progress: 0.2, IsComplete: false })).toBe('WAIT')
  })

  it('trusts IsComplete when the carrier does set it', () => {
    expect(reportReadiness({ IsComplete: true })).toBe('READY')
  })

  it('stops on the carrier own failure flags instead of polling a dead render', () => {
    expect(reportReadiness({ HasException: true, Progress: 0.99 })).toBe('FAILED')
    expect(reportReadiness({ IsAborting: true })).toBe('FAILED')
  })

  it('waits rather than guessing when the carrier answered nothing', () => {
    expect(reportReadiness(null)).toBe('WAIT')
    expect(reportReadiness({})).toBe('WAIT')
  })
})

describe('illustrationDocumentFilename', () => {
  it('names the file after the insured, so a tab strip is readable', () => {
    expect(illustrationDocumentFilename('Paulo Campos', new Date('2026-07-31T14:30:00Z'))).toBe(
      'Paulo-Campos-2026-07-31.pdf',
    )
  })

  it('strips accents and punctuation a filesystem would rather not carry', () => {
    expect(illustrationDocumentFilename('José D\'Ávila', new Date('2026-07-31T00:00:00Z'))).toBe(
      'Jose-D-Avila-2026-07-31.pdf',
    )
  })

  it('still produces a name when the quote never named an insured', () => {
    expect(illustrationDocumentFilename(null, new Date('2026-07-31T00:00:00Z'))).toBe(
      'ilustracao-2026-07-31.pdf',
    )
  })
})

describe('isPdfPayload', () => {
  it('accepts a real document', () => {
    const bytes = new Uint8Array(2048)
    bytes.set([0x25, 0x50, 0x44, 0x46])
    expect(isPdfPayload(bytes)).toBe(true)
  })

  it('rejects the HTML error page the carrier serves with status 200', () => {
    expect(isPdfPayload(new TextEncoder().encode('<html>session expired</html>'))).toBe(false)
  })

  it('rejects a truncated response that merely starts right', () => {
    const bytes = new Uint8Array(100)
    bytes.set([0x25, 0x50, 0x44, 0x46])
    expect(isPdfPayload(bytes)).toBe(false)
  })
})
