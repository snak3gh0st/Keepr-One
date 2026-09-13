import 'server-only'
import { foresightPdfPages } from './foresight-pdf-text'

/// The Term policy's guaranteed schedule, read from the carrier's own Ledger.
///
/// A Term illustration returns four numbers — face amount, premium, mode,
/// duration — and for a long time that was everything Keepr One knew about it.
/// It is not everything the client needs. The Ledger pages of the official
/// Statement of Policy Cost and Benefit Information carry the guaranteed
/// contract premium for *every* year of the policy, and what they show is that
/// the premium stops being level the year after the guarantee ends and then
/// climbs for the rest of the contract. A client-facing document that prints
/// "level premium guaranteed for 10 years" and stops is accurate about year 10
/// and silent about year 11, where the number can be six times larger.
///
/// Everything here is guaranteed, not projected: these are contractual maximums
/// the carrier has committed to, which is why they may be shown without the
/// hedging a current-assumptions projection requires.

const MAX_PREMIUM = 100_000_000
const MAX_DEATH_BENEFIT = 100_000_000
const MAX_POLICY_YEAR = 100
const MINIMUM_LEDGER_ROWS = 2

export type ForesightTermLedgerRow = {
  policyYear: number
  age: number
  guaranteedAnnualPremium: number
  guaranteedDeathBenefit: number
}

export type ForesightTermLedger = {
  rows: ForesightTermLedgerRow[]
  /// How many years the premium actually stays at its opening value, counted
  /// from the ledger rather than taken from the product name. A "10-G" whose
  /// ledger disagrees with its label is a discrepancy worth surfacing, not one
  /// worth papering over, and an annually renewable policy reports 1 here
  /// without needing a special case.
  levelPeriodYears: number
  levelAnnualPremium: number
  /// The first year the premium is no longer the opening one, and what it
  /// becomes. Null when the ledger never increases.
  firstIncrease: { policyYear: number; age: number; annualPremium: number } | null
}

/// `1 38 $522.72 $500,000` — and the same row without the dollar signs, which
/// is how every line after the first one is printed.
///
/// The ten-year subtotals the carrier interleaves between rows (`$5,227.20`,
/// `$51,416.64`) are lone amounts with no year or age in front of them, so they
/// cannot satisfy this shape. The contiguity check below is what actually
/// guarantees none of them was absorbed into a row.
const LEDGER_ROW = new RegExp(String.raw`(?:^|\s)(\d{1,3})\s+(\d{1,3})\s+\$?\s*([\d,]+\.\d{2})\s+\$?\s*(\d{1,3}(?:,\d{3})*)(?=\s|$)`, 'g')

function amount(value: string, ceiling: number): number | null {
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed > 0 && parsed <= ceiling ? parsed : null
}

export function parseForesightTermLedgerText(text: string): ForesightTermLedger {
  const normalized = text.replace(/\s+/g, ' ')
  const rows: ForesightTermLedgerRow[] = []
  for (const match of normalized.matchAll(LEDGER_ROW)) {
    const policyYear = Number(match[1])
    const age = Number(match[2])
    const guaranteedAnnualPremium = amount(match[3]!, MAX_PREMIUM)
    const guaranteedDeathBenefit = amount(match[4]!, MAX_DEATH_BENEFIT)
    if (policyYear < 1 || policyYear > MAX_POLICY_YEAR) continue
    if (guaranteedAnnualPremium === null || guaranteedDeathBenefit === null) continue
    // The ledger repeats across pages under a repeated header; a year seen
    // twice is the same row read twice, not a new one.
    if (rows.some((row) => row.policyYear === policyYear)) continue
    rows.push({ policyYear, age, guaranteedAnnualPremium, guaranteedDeathBenefit })
  }
  rows.sort((left, right) => left.policyYear - right.policyYear)

  // Three checks, and they exist to make a misread impossible to print rather
  // than to be thorough. A stray amount absorbed as a row, a subtotal mistaken
  // for a year, a page read out of order — each breaks one of these, and the
  // whole ledger is then refused instead of a wrong year reaching a client.
  if (rows.length < MINIMUM_LEDGER_ROWS) throw new Error('FORESIGHT_TERM_LEDGER_MISSING')
  if (rows[0]!.policyYear !== 1) throw new Error('FORESIGHT_TERM_LEDGER_INCOMPLETE')
  const consistent = rows.every((row, index) =>
    row.policyYear === index + 1 && row.age === rows[0]!.age + index)
  if (!consistent) throw new Error('FORESIGHT_TERM_LEDGER_INCONSISTENT')

  const levelAnnualPremium = rows[0]!.guaranteedAnnualPremium
  const increaseIndex = rows.findIndex((row) =>
    Math.abs(row.guaranteedAnnualPremium - levelAnnualPremium) > 0.005)
  const increase = increaseIndex === -1 ? null : rows[increaseIndex]!
  return {
    rows,
    levelPeriodYears: increaseIndex === -1 ? rows.length : increaseIndex,
    levelAnnualPremium,
    firstIncrease: increase === null ? null : {
      policyYear: increase.policyYear,
      age: increase.age,
      annualPremium: increase.guaranteedAnnualPremium,
    },
  }
}

export async function extractForesightTermLedger(
  documentBytes: Uint8Array,
): Promise<ForesightTermLedger> {
  const pages = await foresightPdfPages(documentBytes)
  // Only the Ledger pages. The Narrative Summary beside them defines the same
  // column headings in prose and carries cost-index figures in a table of its
  // own, which is exactly the kind of text that could be mistaken for a row.
  const ledger = pages.filter((page) => /\bLedger\b/.test(page) && /Policy Year\s+Age/.test(page))
  if (ledger.length === 0) throw new Error('FORESIGHT_TERM_LEDGER_MISSING')
  return parseForesightTermLedgerText(ledger.join('\n'))
}
