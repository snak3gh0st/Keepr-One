import { describe, it, expect } from 'vitest'
import { formatMoney, formatCompactMoney } from './format'

describe('formatMoney', () => {
  it('adds thousands separators and drops cents on whole amounts', () => {
    expect(formatMoney(500000)).toBe('$500,000')
    expect(formatMoney(320)).toBe('$320')
  })
  it('keeps two decimals when there are cents', () => {
    expect(formatMoney(62.5)).toBe('$62.50')
    expect(formatMoney(2090.5)).toBe('$2,090.50')
  })
})

describe('formatCompactMoney', () => {
  it('compacts large aggregates', () => {
    expect(formatCompactMoney(4150000)).toBe('$4.15M')
    expect(formatCompactMoney(1700000)).toBe('$1.7M')
    expect(formatCompactMoney(0)).toBe('$0')
    expect(formatCompactMoney(320)).toBe('$320')
  })
})
