import { describe, expect, it } from 'vitest'
import { isReadOnlySupportPreview } from './support-preview'

describe('isReadOnlySupportPreview', () => {
  it('recognizes only the authenticated support-preview session marker', () => {
    expect(isReadOnlySupportPreview({ session: { impersonatedBy: 'admin-1' } })).toBe(true)
    expect(isReadOnlySupportPreview({ session: { impersonatedBy: null } })).toBe(false)
    expect(isReadOnlySupportPreview({ session: {} })).toBe(false)
    expect(isReadOnlySupportPreview(null)).toBe(false)
  })
})
