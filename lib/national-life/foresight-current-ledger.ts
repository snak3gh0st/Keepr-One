import 'server-only'
import { foresightPdfPages } from './foresight-pdf-text'

/// O ledger corrente da ilustração, ano a ano.
///
/// Estas páginas trazem dois cenários lado a lado: à esquerda uma taxa
/// alternativa mais baixa, à direita a taxa ilustrada — e é a da direita que a
/// página Summary of Values chama de "Current Illustrated Values". O leitor
/// confere isso: os valores que ele extrai batem, ano a ano, com os que a
/// seguradora resume naquela página.
///
/// A Keepr One precisava disto para desenhar. Com quatro marcos, um gráfico é
/// quatro retas ligando pontos distantes, e o cliente não consegue ler a forma
/// da apólice nem conferir o que está vendo. Com o ledger inteiro, a curva é a
/// apólice.

const MAX_AMOUNT = 1_000_000_000
const MAX_POLICY_YEAR = 121
const MINIMUM_ROWS = 2

export type ForesightCurrentRow = {
  policyYear: number
  age: number
  premiumOutlay: number
  weightedAverageInterestRate: number
  accumulatedValue: number
  cashSurrenderValue: number
  netDeathBenefit: number
}

export type ForesightCurrentLedger = {
  rows: ForesightCurrentRow[]
  lapse: { policyYear: number; age: number } | null
}

/// `1 38 $24,000.00 3.50 % $15,545 $0 $1,701,885 6.84 % $15,816 $0 $1,702,156`
///
/// Ano, idade, aporte, e então os dois cenários. O primeiro bloco é a taxa
/// alternativa e é descartado; o segundo é o corrente. Os valores podem ler
/// `Lapse` no lugar do número, que é como a seguradora marca o fim.
const AMOUNT = String.raw`(?:\$?\s*([\d,]+)|(Lapse))`
const ROW = new RegExp(
  String.raw`(?:^|\s)(\d{1,3})\s+(\d{1,3})\s+\$?\s*([\d,]+\.\d{2})\s+` +
  String.raw`[\d.]+\s*%\s+${AMOUNT}\s+${AMOUNT}\s+${AMOUNT}\s+` +
  String.raw`([\d.]+)\s*%\s+${AMOUNT}\s+${AMOUNT}\s+${AMOUNT}(?=\s|$)`,
  'g')

function amount(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_AMOUNT ? parsed : null
}

export function parseForesightCurrentLedgerText(text: string): ForesightCurrentLedger {
  const normalized = text.replace(/\s+/g, ' ')
  const rows: ForesightCurrentRow[] = []
  let lapse: ForesightCurrentLedger['lapse'] = null

  for (const match of normalized.matchAll(ROW)) {
    const policyYear = Number(match[1])
    const age = Number(match[2])
    const premiumOutlay = amount(match[3])
    const rate = Number(match[10])
    if (policyYear < 1 || policyYear > MAX_POLICY_YEAR) continue
    if (premiumOutlay === null || !Number.isFinite(rate)) continue
    if (rows.some((row) => row.policyYear === policyYear)) continue
    if (lapse !== null && lapse.policyYear === policyYear) continue

    // O bloco corrente é o segundo: grupos 11 a 16 do padrão acima.
    const values = [amount(match[11]), amount(match[13]), amount(match[15])]
    const lapsed = match[12] !== undefined || match[14] !== undefined || match[16] !== undefined
    if (lapsed) {
      lapse ??= { policyYear, age }
      continue
    }
    if (values.some((value) => value === null)) continue
    rows.push({
      policyYear, age, premiumOutlay,
      weightedAverageInterestRate: rate,
      accumulatedValue: values[0]!,
      cashSurrenderValue: values[1]!,
      netDeathBenefit: values[2]!,
    })
  }
  rows.sort((left, right) => left.policyYear - right.policyYear)

  if (rows.length < MINIMUM_ROWS) throw new Error('FORESIGHT_CURRENT_LEDGER_MISSING')
  if (rows[0]!.policyYear !== 1) throw new Error('FORESIGHT_CURRENT_LEDGER_INCOMPLETE')
  const consistent = rows.every((row, index) =>
    row.policyYear === index + 1 && row.age === rows[0]!.age + index)
  if (!consistent) throw new Error('FORESIGHT_CURRENT_LEDGER_INCONSISTENT')
  if (lapse !== null && lapse.policyYear <= rows[rows.length - 1]!.policyYear) {
    throw new Error('FORESIGHT_CURRENT_LEDGER_INCONSISTENT')
  }
  return { rows, lapse }
}

export async function extractForesightCurrentLedger(
  documentBytes: Uint8Array,
): Promise<ForesightCurrentLedger> {
  const pages = await foresightPdfPages(documentBytes)
  // As páginas do ledger corrente, e só elas. A Summary of Values carrega o
  // mesmo título acima de três cenários e seria lida errado aqui.
  const current = pages.filter((page) =>
    /Current Illustrated Values/.test(page) &&
    /Policy Year\s+Age\s+Premium Outlay/.test(page) &&
    !/Summary of Values/.test(page) &&
    !/Guaranteed Illustrated Values\s+Policy Year/.test(page))
  if (current.length === 0) throw new Error('FORESIGHT_CURRENT_LEDGER_MISSING')
  return parseForesightCurrentLedgerText(current.join('\n'))
}
