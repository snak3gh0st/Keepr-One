import { describe, expect, it } from 'vitest'
import {
  currentCarrierChargebackSnapshot,
  NO_PERIOD,
  parseCarrierAmount,
  projectedPayableSnapshotForPeriod,
  sumByPeriod,
  toCarrierCommissionRecords,
  toVisibleCarrierCommissionRecords,
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
      row({ PaymentDate: '7/9/2026', PolicyNumber: 'X1', WritingAgtName: 'Ana', WritingAgtLevel: 'Personal' },
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
    expect(toCarrierCommissionRecords([row({ PaymentDate: '7/9/2026', WritingAgtLevel: 'Personal' }, {})])).toEqual([])
  })

  it('fails closed when the carrier role is missing or unfamiliar', () => {
    expect(toCarrierCommissionRecords([
      row({ PaymentDate: '7/9/2026' }, { GrossCommEarned: '$10' }),
      row({ PaymentDate: '7/9/2026', WritingAgtLevel: 'Team' }, { GrossCommEarned: '$20' }),
    ])).toEqual([])
  })

  it('survives rows whose payload is not an object', () => {
    expect(toCarrierCommissionRecords([{ id: 'a', raw: null, amounts: undefined }])).toEqual([])
  })
})

describe('toVisibleCarrierCommissionRecords', () => {
  const scopedRow = (
    agentId: string,
    policyNumber: string,
    level: 'Personal' | 'Override',
    amount: string,
  ) => ({
    ...row({
      PaymentDate: '8/25/2026',
      PolicyNumber: policyNumber,
      WritingAgtLevel: level,
    }, { GrossCommEarned: amount }),
    agentId,
  })

  it('shows direct and override earnings returned by the current agent connector', () => {
    const records = toVisibleCarrierCommissionRecords([
      scopedRow('agent-1', 'DIRECT-1', 'Personal', '$100'),
      scopedRow('agent-1', 'OVERRIDE-1', 'Override', '$250'),
    ], 'agent-1')

    expect(records.map((record) => record.type)).toEqual(['DIRECT', 'OVERRIDE'])
    expect(totalOf(records)).toBe(350)
  })

  it('keeps member direct production visible without importing the member override', () => {
    const records = toVisibleCarrierCommissionRecords([
      scopedRow('owner', 'OWNER-OVERRIDE', 'Override', '$250'),
      scopedRow('member', 'MEMBER-DIRECT', 'Personal', '$100'),
      scopedRow('member', 'MEMBER-OVERRIDE', 'Override', '$900'),
    ], 'owner')

    expect(records.map((record) => record.policyNumber)).toEqual([
      'OWNER-OVERRIDE',
      'MEMBER-DIRECT',
    ])
    expect(totalOf(records)).toBe(350)
  })
})

describe('totals', () => {
  const records = toCarrierCommissionRecords([
    row({ PaymentDate: '6/1/2026', PolicyNumber: 'A', WritingAgtLevel: 'Personal' }, { GrossCommEarned: '$100' }),
    row({ PaymentDate: '7/1/2026', PolicyNumber: 'B', WritingAgtLevel: 'Personal' }, { GrossCommEarned: '$200' }),
    row({ PaymentDate: '7/2/2026', PolicyNumber: 'C', WritingAgtLevel: 'Personal' }, { GrossCommEarned: '$50' }),
    row({ PaymentDate: '', PolicyNumber: 'D', WritingAgtLevel: 'Personal' }, { GrossCommEarned: '$7' }),
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
      row({ PaymentDate: '7/1/2026', WritingAgtLevel: 'Personal' }, { GrossCommEarned: '$200' }),
      row({ PaymentDate: '7/1/2026', WritingAgtLevel: 'Personal' }, { GrossCommEarned: '-$50' }),
    ])
    expect(totalOf(withChargeback)).toBe(150)
  })
})

describe('projectedPayableSnapshotForPeriod', () => {
  const payableRow = (
    id: string,
    paymentDate: string,
    amount: string,
    fetchedAt = '2026-08-27T16:40:08.568Z',
  ) => ({
    id,
    agentId: 'agent-1',
    primaryDate: new Date(paymentDate),
    fetchedAt: new Date(fetchedAt),
    raw: {
      PaymentDate: paymentDate,
      AgentNumber: 'A-1',
      WritingAgentNumber: `W-${id}`,
    },
    amounts: { NLLifeAmount: amount },
  })

  it('sums the six payable carrier fields only for the requested month', () => {
    const snapshot = projectedPayableSnapshotForPeriod([
      {
        ...payableRow('aug', '08/25/2026', '$10,000.00'),
        amounts: {
          NLLifeAmount: '$10,000.00',
          NLAnnuitiesAmount: '$500.00',
          NLMutualFundsAmount: '$100.00',
          LSWLifeAmount: '$5,000.00',
          LSWAnnuitiesAmount: '$300.00',
          VariableProductAmount: '$6.00',
        },
      },
      payableRow('jul', '07/25/2026', '$99,999.00'),
    ], '2026-08')

    expect(snapshot).toEqual({ total: 15_906, asOf: '2026-08-25', rowCount: 1 })
  })

  it('keeps only the newest version of the same carrier payable row', () => {
    const older = payableRow('old', '08/25/2026', '$100.00', '2026-08-26T12:00:00Z')
    const corrected = {
      ...payableRow('new', '08/25/2026', '$125.00', '2026-08-27T12:00:00Z'),
      raw: older.raw,
    }

    expect(projectedPayableSnapshotForPeriod([older, corrected], '2026-08')).toEqual({
      total: 125,
      asOf: '2026-08-25',
      rowCount: 1,
    })
  })
})

describe('currentCarrierChargebackSnapshot', () => {
  const statementRow = (
    id: string,
    agentId: string,
    payDate: string,
    balance: string,
  ) => ({
    id,
    agentId,
    primaryDate: new Date(payDate),
    fetchedAt: new Date('2026-08-27T16:40:08.568Z'),
    raw: { PayDate: payDate },
    amounts: { CommChargebackBalance: balance },
  })

  it('uses the latest statement balance rather than adding historical balances', () => {
    expect(currentCarrierChargebackSnapshot([
      statementRow('old-a', 'agent-1', '08/18/2026', '$900.00'),
      statementRow('new-a', 'agent-1', '08/25/2026', '$40.00'),
      statementRow('new-b', 'agent-1', '08/25/2026', '$10.00'),
    ])).toEqual({ total: 50, asOf: '2026-08-25', rowCount: 2 })
  })

  it('selects the latest statement independently for every entitled agent', () => {
    expect(currentCarrierChargebackSnapshot([
      statementRow('owner', 'owner', '08/25/2026', '$20.00'),
      statementRow('member-old', 'member', '08/11/2026', '$70.00'),
      statementRow('member-new', 'member', '08/18/2026', '$30.00'),
    ])).toEqual({ total: 50, asOf: '2026-08-25', rowCount: 2 })
  })
})
