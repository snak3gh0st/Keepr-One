/** Contact review helpers. Never infer a country from a customer's name or language. */
export type PhoneIssue = 'MISSING' | 'COUNTRY_REQUIRED' | 'INVALID' | 'SHARED'

export function phoneIssue(value: string | null | undefined): Exclude<PhoneIssue, 'SHARED'> | null {
  if (!value?.trim()) return 'MISSING'
  if (!/^\s*\+/.test(value)) return /^[\d\s().-]+$/.test(value) ? 'COUNTRY_REQUIRED' : 'INVALID'
  if (!/^\s*\+[\d\s().-]+$/.test(value)) return 'INVALID'
  return /^[1-9]\d{7,14}$/.test(value.replace(/\D/g, '')) ? null : 'INVALID'
}

export function reviewedPhone(value: string, country: '' | '1' | '55'): string | null {
  if (/^\s*\+/.test(value)) return phoneIssue(value) === null ? '+' + value.replace(/\D/g, '') : null
  if (!country || !/^[\d\s().-]+$/.test(value)) return null
  const digits = value.replace(/\D/g, '')
  if (country === '1' && digits.length !== 10) return null
  if (country === '55' && ![10, 11].includes(digits.length)) return null
  const result = `+${country}${digits}`
  return phoneIssue(result) === null ? result : null
}
