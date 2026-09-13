import 'server-only'
import { foresightPdfPages } from './foresight-pdf-text'

/// The FlexLife policy's guaranteed ledger, read from the carrier's own
/// illustration.
///
/// A FlexLife projection has two halves and Keepr One has only ever held one of
/// them. The Quick View returns current values — what the policy does if the
/// illustrated rates and charges hold — and says nothing about the guaranteed
/// half, which assumes the minimum credited rate and the maximum deductions the
/// carrier is contractually allowed to take. On a real illustration the
/// difference is not a matter of degree: the accumulated value peaks and then
/// falls, and the policy lapses in year 42 unless more premium is paid. That
/// sentence is printed on the carrier's own page and was nowhere in Keepr One.
///
/// Only the guaranteed pages are read here. The current-value pages of the same
/// document are laid out two columns of scenarios wide, which cannot be read
/// from text order — and need not be, because the Quick View already returns
/// those values.

const MAX_AMOUNT = 1_000_000_000
const MAX_POLICY_YEAR = 121
const MINIMUM_LEDGER_ROWS = 2

export type ForesightGuaranteedRow = {
  policyYear: number
  age: number
  premiumOutlay: number
  accumulatedValue: number
  cashSurrenderValue: number
  netDeathBenefit: number
}

export type ForesightGuaranteedLedger = {
  rows: ForesightGuaranteedRow[]
  /// The year the carrier marks the policy as lapsing on guaranteed
  /// assumptions, taken from the row where it prints "Lapse" in place of the
  /// values. Null when the ledger runs to the end without one.
  lapse: { policyYear: number; age: number } | null
}

/// `1 38 $24,000.00 $12,817 $0 $1,699,157`, and the same row without the dollar
/// signs, which is how every line after the first is printed. The three value
/// columns may each read `Lapse` instead of an amount, which is how the carrier
/// marks the year the policy ends.
///
/// The ten-year premium subtotals interleaved between rows (`$960,000.00`) are
/// lone amounts with no year or age in front of them and cannot satisfy this
/// shape; the contiguity check below is what actually guarantees none was
/// absorbed into a row.
const AMOUNT = String.raw`(?:\$?\s*([\d,]+)|(Lapse))`
const LEDGER_ROW = new RegExp(
  String.raw`(?:^|\s)(\d{1,3})\s+(\d{1,3})\s+\$?\s*([\d,]+\.\d{2})\s+${AMOUNT}\s+${AMOUNT}\s+${AMOUNT}(?=\s|$)`,
  'g')

function amount(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_AMOUNT ? parsed : null
}

export function parseForesightGuaranteedLedgerText(text: string): ForesightGuaranteedLedger {
  const normalized = text.replace(/\s+/g, ' ')
  const rows: ForesightGuaranteedRow[] = []
  let lapse: ForesightGuaranteedLedger['lapse'] = null

  for (const match of normalized.matchAll(LEDGER_ROW)) {
    const policyYear = Number(match[1])
    const age = Number(match[2])
    const premiumOutlay = amount(match[3])
    if (policyYear < 1 || policyYear > MAX_POLICY_YEAR || premiumOutlay === null) continue
    if (rows.some((row) => row.policyYear === policyYear)) continue
    if (lapse !== null && lapse.policyYear === policyYear) continue

    // The lapse row carries a premium and then the word in place of every
    // value. It is the end of the ledger, not a row of it: printing a zero
    // there would say the policy is worth nothing while still in force, and
    // printing nothing at all would lose the fact entirely.
    const values = [amount(match[4]), amount(match[6]), amount(match[8])]
    const lapsed = match[5] !== undefined || match[7] !== undefined || match[9] !== undefined
    if (lapsed) {
      lapse ??= { policyYear, age }
      continue
    }
    if (values.some((value) => value === null)) continue
    rows.push({
      policyYear, age, premiumOutlay,
      accumulatedValue: values[0]!,
      cashSurrenderValue: values[1]!,
      netDeathBenefit: values[2]!,
    })
  }
  rows.sort((left, right) => left.policyYear - right.policyYear)

  // The same three refusals the Term ledger makes, for the same reason: a
  // misread must be impossible to print rather than merely unlikely.
  if (rows.length < MINIMUM_LEDGER_ROWS) throw new Error('FORESIGHT_GUARANTEED_LEDGER_MISSING')
  if (rows[0]!.policyYear !== 1) throw new Error('FORESIGHT_GUARANTEED_LEDGER_INCOMPLETE')
  const consistent = rows.every((row, index) =>
    row.policyYear === index + 1 && row.age === rows[0]!.age + index)
  if (!consistent) throw new Error('FORESIGHT_GUARANTEED_LEDGER_INCONSISTENT')
  // A lapse before the ledger it ends would mean the pages were read out of
  // order, or that something else on the sheet was mistaken for the marker.
  if (lapse !== null && lapse.policyYear <= rows[rows.length - 1]!.policyYear) {
    throw new Error('FORESIGHT_GUARANTEED_LEDGER_INCONSISTENT')
  }
  return { rows, lapse }
}

export async function extractForesightGuaranteedLedger(
  documentBytes: Uint8Array,
): Promise<ForesightGuaranteedLedger> {
  const pages = await foresightPdfPages(documentBytes)
  // The guaranteed ledger pages, and only those. The Summary of Values page
  // carries the same heading above three scenarios side by side, and the
  // narrative pages carry it in prose — both would be read wrong here, so both
  // are excluded by what they also contain.
  const guaranteed = pages.filter((page) =>
    /Guaranteed Illustrated Values/.test(page) &&
    /Policy Year\s+Age\s+Premium Outlay/.test(page) &&
    !/Current Illustrated Values/.test(page))
  if (guaranteed.length === 0) throw new Error('FORESIGHT_GUARANTEED_LEDGER_MISSING')
  return parseForesightGuaranteedLedgerText(guaranteed.join('\n'))
}
