import { describe, expect, it } from 'vitest'
import { founderLeadSchema, normalizeUsPhone } from './founder-lead-validation'

describe('normalizeUsPhone', () => {
  it.each([
    '(212) 555-0100',
    '2125550100',
    '+1 (212) 555-0100',
    '+12125550100',
    '1 212 555 0100',
    '12125550100',
    ' 212.555.0100 ',
  ])('normalizes a complete US phone number: %s', (input) => {
    expect(normalizeUsPhone(input)).toBe('+12125550100')
  })

  it.each([
    '',
    '555-0100',
    '212555010',
    '21255501000',
    '+1 012 555 0100',
    '+1 212 155 0100',
    '+1 999 555 0100',
    '+1 212 555 0100 ext 4',
    'Call 2125550100',
    '212555010a',
    '1-800-FLOWERS',
    '++12125550100',
    '212+5550100',
    '2'.repeat(100),
  ])('rejects incomplete, invalid, or contaminated input: %s', (input) => {
    expect(normalizeUsPhone(input)).toBeNull()
  })

  it.each([
    '+55 (11) 99999-9999',
    '+44 20 7946 0018',
    '+1 416 555 0100',
    '4165550100',
    '+1 242 359 1234',
    '+1 787 234 5678',
  ])('rejects a non-US number even when its country code is +1: %s', (input) => {
    expect(normalizeUsPhone(input)).toBeNull()
  })
})

describe('founderLeadSchema', () => {
  it('returns only the three normalized contact fields', () => {
    expect(founderLeadSchema.parse({
      name: '  Maria Founder  ',
      email: ' Maria@Example.com ',
      phone: '(212) 555-0100',
      role: 'ADMIN',
    })).toEqual({
      name: 'Maria Founder',
      email: 'maria@example.com',
      phone: '+12125550100',
    })
  })

  it('returns actionable errors for all invalid contact fields', () => {
    const parsed = founderLeadSchema.safeParse({ name: ' ', email: 'bad', phone: '+5511999999999' })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Invalid contact fields unexpectedly passed validation')
    expect(parsed.error.flatten().fieldErrors).toEqual({
      name: [expect.any(String)],
      email: [expect.any(String)],
      phone: [expect.any(String)],
    })
  })

  it('enforces the name limit and validates email after trimming', () => {
    const contact = { name: 'a'.repeat(100), email: ' maria@example.com ', phone: '2125550100' }
    expect(founderLeadSchema.safeParse(contact).success).toBe(true)
    expect(founderLeadSchema.safeParse({ ...contact, name: 'a'.repeat(101) }).success).toBe(false)
    expect(founderLeadSchema.safeParse({ ...contact, name: 'a' }).success).toBe(false)
    expect(founderLeadSchema.safeParse({ ...contact, email: 'maria @example.com' }).success).toBe(false)
    expect(founderLeadSchema.safeParse({ ...contact, email: `${'a'.repeat(243)}@example.com` }).success).toBe(false)
  })
})
