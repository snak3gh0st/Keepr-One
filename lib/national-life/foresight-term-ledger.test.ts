import { describe, expect, it } from 'vitest'
import { parseForesightTermLedgerText } from './foresight-term-ledger'

/// Transcribed from the Ledger page of a real National Life Statement of
/// Policy Cost and Benefit Information (Term 10-G, Statement ID 46896),
/// including the ten-year subtotals the carrier interleaves between rows and
/// the header that repeats above every page of the table.
const LEDGER_PAGE = `STATEMENT OF POLICY COST AND BENEFIT INFORMATION Term 10-G Term Life Insurance
Ledger Paulo Loureiro Campos Face Amount: $500,000 Male 38 Standard Non-Tobacco
Initial Premium: $43.56 Monthly (EFT) Riders: ABR State: Florida
Policy Year Age Guaranteed Contract Premium Guaranteed Death Benefit
1 38 $522.72 $500,000 2 39 522.72 500,000 3 40 522.72 500,000 4 41 522.72 500,000
5 42 522.72 500,000 6 43 522.72 500,000 7 44 522.72 500,000 8 45 522.72 500,000
9 46 522.72 500,000 10 47 522.72 500,000 $5,227.20
11 48 3,352.80 500,000 12 49 3,495.36 500,000 13 50 3,674.88 500,000
14 51 3,944.16 500,000 15 52 4,282.08 500,000 $51,416.64
Life Insurance Company of the Southwest, Addison, TX 75001 Page 6 of 8`

describe('the Term ledger', () => {
  const ledger = parseForesightTermLedgerText(LEDGER_PAGE)

  it('reads every year the carrier printed', () => {
    expect(ledger.rows).toHaveLength(15)
    expect(ledger.rows[0]).toEqual({
      policyYear: 1, age: 38, guaranteedAnnualPremium: 522.72, guaranteedDeathBenefit: 500_000,
    })
    expect(ledger.rows[14]!.guaranteedAnnualPremium).toBe(4_282.08)
  })

  // The carrier prints a running ten-year total between rows. It looks like an
  // amount in the same column and is not a year of anything.
  it('does not mistake the ten-year subtotals for policy years', () => {
    const premiums = ledger.rows.map((row) => row.guaranteedAnnualPremium)
    expect(premiums).not.toContain(5_227.20)
    expect(premiums).not.toContain(51_416.64)
  })

  // The whole reason this exists: the guarantee ends and the premium does not
  // stay where it was.
  it('finds where the level premium stops and what it becomes', () => {
    expect(ledger.levelPeriodYears).toBe(10)
    expect(ledger.levelAnnualPremium).toBe(522.72)
    expect(ledger.firstIncrease).toEqual({ policyYear: 11, age: 48, annualPremium: 3_352.80 })
  })

  it('counts the level period from the ledger, not from the product name', () => {
    const annuallyRenewable = parseForesightTermLedgerText(
      'Policy Year Age Guaranteed Contract Premium Guaranteed Death Benefit ' +
      '1 38 $522.72 $500,000 2 39 611.04 500,000 3 40 702.24 500,000')
    expect(annuallyRenewable.levelPeriodYears).toBe(1)
    expect(annuallyRenewable.firstIncrease?.policyYear).toBe(2)
  })

  it('reports no increase when the premium never moves', () => {
    const flat = parseForesightTermLedgerText('1 38 $522.72 $500,000 2 39 522.72 500,000')
    expect(flat.levelPeriodYears).toBe(2)
    expect(flat.firstIncrease).toBeNull()
  })

  // Every refusal below exists so a misread cannot reach a client as a number.
  it('refuses a ledger that does not start at the first policy year', () => {
    expect(() => parseForesightTermLedgerText('3 40 $522.72 $500,000 4 41 522.72 500,000'))
      .toThrow('FORESIGHT_TERM_LEDGER_INCOMPLETE')
  })

  it('refuses a ledger with a year missing from the middle', () => {
    expect(() => parseForesightTermLedgerText(
      '1 38 $522.72 $500,000 2 39 522.72 500,000 4 41 522.72 500,000'))
      .toThrow('FORESIGHT_TERM_LEDGER_INCONSISTENT')
  })

  it('refuses a ledger whose ages do not advance with its years', () => {
    expect(() => parseForesightTermLedgerText(
      '1 38 $522.72 $500,000 2 39 522.72 500,000 3 55 522.72 500,000'))
      .toThrow('FORESIGHT_TERM_LEDGER_INCONSISTENT')
  })

  it('refuses a page with nothing that reads as a row', () => {
    expect(() => parseForesightTermLedgerText('Policy Year Age Guaranteed Contract Premium'))
      .toThrow('FORESIGHT_TERM_LEDGER_MISSING')
  })
})
