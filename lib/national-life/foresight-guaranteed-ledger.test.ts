import { describe, expect, it } from 'vitest'
import { parseForesightGuaranteedLedgerText } from './foresight-guaranteed-ledger'

/// Transcribed from the Guaranteed Illustrated Values pages of a real National
/// Life FlexLife illustration (Illustration ID 79382), including the ten-year
/// premium subtotals interleaved between rows and the lapse row that ends it.
const LEDGER = `Guaranteed Illustrated Values
Policy Year Age Premium Outlay Accumu- lated Value Cash Surrender Value Net Death Benefit
1 38 $24,000.00 $12,817 $0 $1,699,157
2 39 24,000.00 25,607 0 1,711,947
3 40 24,000.00 38,319 9,348 1,724,659
4 41 24,000.00 50,968 23,717 1,737,308 $96,000.00
5 42 24,000.00 63,588 38,141 1,749,928
6 43 24,000.00 76,143 52,499 1,762,483
7 44 24,000.00 41,481 41,481 1,727,821
8 45 14,000.00 Lapse Lapse Lapse $182,000.00
The policy as shown using the Guaranteed Illustrated Values will lapse in policy
year 8 unless a higher premium is paid.`

describe('the guaranteed ledger', () => {
  const ledger = parseForesightGuaranteedLedgerText(LEDGER)

  it('reads every year the carrier valued', () => {
    expect(ledger.rows).toHaveLength(7)
    expect(ledger.rows[0]).toEqual({
      policyYear: 1, age: 38, premiumOutlay: 24_000,
      accumulatedValue: 12_817, cashSurrenderValue: 0, netDeathBenefit: 1_699_157,
    })
  })

  // A cash surrender value of zero in the early years is a real figure — the
  // surrender charge has consumed the account — not a missing one.
  it('keeps a genuine zero rather than discarding the row that holds it', () => {
    expect(ledger.rows[1]!.cashSurrenderValue).toBe(0)
  })

  // The whole reason to read this half of the illustration: on guaranteed
  // assumptions the policy ends, and the current-value projection never says so.
  it('records the year the policy lapses on guaranteed assumptions', () => {
    expect(ledger.lapse).toEqual({ policyYear: 8, age: 45 })
  })

  it('does not carry the lapse year as though it were a year of values', () => {
    expect(ledger.rows.map((row) => row.policyYear)).not.toContain(8)
  })

  it('does not mistake the premium subtotals for policy years', () => {
    expect(ledger.rows.map((row) => row.premiumOutlay)).not.toContain(96_000)
    expect(ledger.rows.map((row) => row.accumulatedValue)).not.toContain(182_000)
  })

  it('reports no lapse for a ledger that runs to the end without one', () => {
    const intact = parseForesightGuaranteedLedgerText(
      '1 38 $24,000.00 $12,817 $0 $1,699,157 2 39 24,000.00 25,607 0 1,711,947')
    expect(intact.lapse).toBeNull()
    expect(intact.rows).toHaveLength(2)
  })

  it('refuses a ledger that does not start at the first policy year', () => {
    expect(() => parseForesightGuaranteedLedgerText(
      '3 40 $24,000.00 $38,319 $9,348 $1,724,659 4 41 24,000.00 50,968 23,717 1,737,308'))
      .toThrow('FORESIGHT_GUARANTEED_LEDGER_INCOMPLETE')
  })

  it('refuses a ledger with a year missing from the middle', () => {
    expect(() => parseForesightGuaranteedLedgerText(
      '1 38 $24,000.00 $12,817 $0 $1,699,157 2 39 24,000.00 25,607 0 1,711,947 ' +
      '4 41 24,000.00 50,968 23,717 1,737,308'))
      .toThrow('FORESIGHT_GUARANTEED_LEDGER_INCONSISTENT')
  })

  // A lapse inside the ledger it is supposed to end means the pages were read
  // out of order, or that something else was mistaken for the marker.
  it('refuses a lapse that falls before the end of the values', () => {
    expect(() => parseForesightGuaranteedLedgerText(
      '1 38 $24,000.00 $12,817 $0 $1,699,157 2 39 24,000.00 Lapse Lapse Lapse ' +
      '3 40 24,000.00 38,319 9,348 1,724,659'))
      .toThrow('FORESIGHT_GUARANTEED_LEDGER_INCONSISTENT')
  })

  it('refuses a page with nothing that reads as a row', () => {
    expect(() => parseForesightGuaranteedLedgerText('Guaranteed Illustrated Values Policy Year Age'))
      .toThrow('FORESIGHT_GUARANTEED_LEDGER_MISSING')
  })
})
