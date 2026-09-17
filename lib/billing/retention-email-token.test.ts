import { describe, expect, it } from 'vitest'
import {
  retentionEmailOptOutToken,
  verifyRetentionEmailOptOutToken,
} from './retention-email-token'

const SECRET = 'a'.repeat(48)
const WEAK = 'short'

describe('retentionEmailOptOutToken', () => {
  it('refuses to mint a link without a strong secret', () => {
    expect(retentionEmailOptOutToken('sub-1', WEAK)).toBeNull()
    expect(retentionEmailOptOutToken('sub-1', undefined)).toBeNull()
  })

  it('is stable for the same subscription, so the whole sequence shares one link', () => {
    expect(retentionEmailOptOutToken('sub-1', SECRET))
      .toBe(retentionEmailOptOutToken('sub-1', SECRET))
  })

  it('cannot unsubscribe an account other than the one it was minted for', () => {
    const token = retentionEmailOptOutToken('sub-1', SECRET)!
    expect(verifyRetentionEmailOptOutToken('sub-1', token, SECRET)).toBe(true)
    expect(verifyRetentionEmailOptOutToken('sub-2', token, SECRET)).toBe(false)
  })

  it('is URL-safe, since it travels as a query parameter', () => {
    const token = retentionEmailOptOutToken('sub-1', SECRET)!
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('verifyRetentionEmailOptOutToken', () => {
  it('rejects an empty or truncated token instead of throwing', () => {
    const token = retentionEmailOptOutToken('sub-1', SECRET)!
    expect(verifyRetentionEmailOptOutToken('sub-1', '', SECRET)).toBe(false)
    expect(verifyRetentionEmailOptOutToken('sub-1', token.slice(0, -2), SECRET)).toBe(false)
  })

  it('rejects everything when no strong secret is configured', () => {
    expect(verifyRetentionEmailOptOutToken('sub-1', 'anything', WEAK)).toBe(false)
  })

  it('rejects a token minted with a different secret', () => {
    const other = retentionEmailOptOutToken('sub-1', 'b'.repeat(48))!
    expect(verifyRetentionEmailOptOutToken('sub-1', other, SECRET)).toBe(false)
  })
})
