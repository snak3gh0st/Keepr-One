import { describe, expect, it } from 'vitest'
import {
  NO_PERIOD,
  parseCarrierAmount,
  sumByPeriod,
  toCarrierCommissionRecords,
  toPeriod,
  totalForPeriod,
  totalOf,
} from './commission-records'

const row = (raw: Record<string, unknown>, amounts: Record<string, unknown> = {}) => ({
  id: raw.PolicyNumber ? `row-${raw.PolicyNumber}` : 'row',
  raw,
  amounts,
})

describe('parseCarrierAmount', () => {
  it('reads the carrier display format', () => {
    expect(parseCarrierAmount('$1,234.56')).toBe(1234.56)
  })

  it('reads a negative chargeback as negative', () => {
    expect(parseCarrierAmount('-$40.00')).toBe(-40)
    expect(parseCarrierAmount('($40.00)')).toBe(-40)
  })

  it('refuses a blank or non-numeric value instead of calling it zero', () => {
    // Zero would silently understate a total; null lets the caller drop the row.
    expect(parseCarrierAmount('')).toBeNull()
    expect(parseCarrierAmount('   ')).toBeNull()
    expect(parseCarrierAmount('n/a')).toBeNull()
    expect(parseCarrierAmount(null)).toBeNull()
    expect(parseCarrierAmount(undefined)).toBeNull()
  })
})

describe('toPeriod', () => {
  it('converts the carrier date to a sortable period', () => {
    expect(toPeriod('7/9/2026')).toBe('2026-07')
    expect(toPeriod('12/25/2026')).toBe('2026-12')
  })

  it('zero-pads so periods sort as strings', () => {
    expect(toPeriod('3/1/2026') < toPeriod('11/1/2026')).toBe(true)
  })

  it('buckets an unusable date rather than dropping the money', () => {
    expect(toPeriod('')).toBe(NO_PERIOD)
    expect(toPeriod(null)).toBe(NO_PERIOD)
    expect(toPeriod('not a date')).toBe(NO_PERIOD)
  })
})

describe('toCarrierCommissionRecords', () => {
  it('reads the gross earned from the amounts payload', () => {
    const [record] = toCarrierCommissionRecords([
      row({ PaymentDate: '7/9/2026', PolicyNumber: 'X1', WritingAgtName: 'Ana' },
          { GrossCommEarned: '$120.50' }),
    ])

    expect(record).toMatchObject({
      period: '2026-07',
      type: 'DIRECT',
      level: 0,
      amount: 120.5,
      policyNumber: 'X1',
      writingAgentName: 'Ana',
    })
  })

  it('marks an override transaction by the carrier label', () => {
    const [record] = toCarrierCommissionRecords([
      row({ WritingAgtLevel: 'Override', PaymentDate: '7/9/2026' }, { GrossCommEarned: '$10' }),
    ])

    expect(record.type).toBe('OVERRIDE')
    expect(record.level).toBe(1)
  })

  it('drops a row with no readable amount instead of counting it as zero', () => {
    expect(toCarrierCommissionRecords([row({ PaymentDate: '7/9/2026' }, {})])).toEqual([])
  })

  it('survives rows whose payload is not an object', () => {
    expect(toCarrierCommissionRecords([{ id: 'a', raw: null, amounts: undefined }])).toEqual([])
  })
})

describe('totals', () => {
  const records = toCarrierCommissionRecords([
    row({ PaymentDate: '6/1/2026', PolicyNumber: 'A' }, { GrossCommEarned: '$100' }),
    row({ PaymentDate: '7/1/2026', PolicyNumber: 'B' }, { GrossCommEarned: '$200' }),
    row({ PaymentDate: '7/2/2026', PolicyNumber: 'C' }, { GrossCommEarned: '$50' }),
    row({ PaymentDate: '', PolicyNumber: 'D' }, { GrossCommEarned: '$7' }),
  ])

  it('sums everything, including money with no usable date', () => {
    expect(totalOf(records)).toBe(357)
  })

  it('sums one period', () => {
    expect(totalForPeriod(records, '2026-07')).toBe(250)
    expect(totalForPeriod(records, '2026-06')).toBe(100)
  })

  it('groups by period in ascending order', () => {
    expect(sumByPeriod(records)).toEqual([
      { period: '2026-06', total: 100 },
      { period: '2026-07', total: 250 },
    ])
  })

  it('keeps undated money out of a trend, which plots time', () => {
    expect(sumByPeriod(records).some((entry) => entry.period === NO_PERIOD)).toBe(false)
  })

  it('honours a period window', () => {
    expect(sumByPeriod(records, { from: '2026-07', to: '2026-07' })).toEqual([
      { period: '2026-07', total: 250 },
    ])
  })

  it('nets a chargeback against earnings rather than ignoring it', () => {
    const withChargeback = toCarrierCommissionRecords([
      row({ PaymentDate: '7/1/2026' }, { GrossCommEarned: '$200' }),
      row({ PaymentDate: '7/1/2026' }, { GrossCommEarned: '-$50' }),
    ])
    expect(totalOf(withChargeback)).toBe(150)
  })
})
