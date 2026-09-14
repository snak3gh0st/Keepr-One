import 'server-only'
import { foresightPdfPages } from './foresight-pdf-text'

/// A página "Summary of Values" da ilustração oficial, que é como a National
/// Life apresenta a apólice quando quer mostrá-la inteira numa folha.
///
/// Ela põe os cenários lado a lado — garantido, corrente e médio — nos mesmos
/// anos, e fecha com o ano de encerramento de cada um. É a única página do
/// documento que responde "e se as premissas não se confirmarem?" sem obrigar
/// o leitor a cruzar três ledgers de páginas diferentes.
///
/// A Keepr One passou a ler daqui em vez de montar a projeção por conta
/// própria: os números do cliente vêm da folha que a seguradora assina, e a
/// peça deixa de depender de uma tela que pode não ter sido capturada.

const MAX_AMOUNT = 1_000_000_000
const MAX_POLICY_YEAR = 121
const MINIMUM_ROWS = 2

export type ForesightScenarioValues = {
  annualCashFlow: number
  cashSurrenderValue: number
  netDeathBenefit: number
}

export type ForesightSummaryRow = {
  policyYear: number
  age: number
  guaranteed: ForesightScenarioValues
  current: ForesightScenarioValues
}

export type ForesightSummaryOfValues = {
  rows: ForesightSummaryRow[]
  /// O ano em que a apólice se encerra em cada cenário. O corrente também
  /// encerra, e é o número que uma peça só-corrente nunca conta.
  lapseYear: { guaranteed: number | null; current: number | null }
}

/// `5 42 -24,000 38,141 1,749,928 -24,000 62,214 1,774,001 -24,000 49,577 1,761,364`
///
/// Ano, idade e três blocos de três valores — garantido, corrente e médio. O
/// médio é lido e descartado: é uma interpolação entre os outros dois e não diz
/// ao cliente nada que os dois extremos já não digam.
const ROW = new RegExp(
  String.raw`(?:^|\s)(\d{1,3})\s+(\d{1,3})\s+((?:-?[\d,]+\s+){8}-?[\d,]+)(?=\s|$)`, 'g')

const LAPSE = /Lapse Year\s+(\d{1,3})?\s*(\d{1,3})?\s*(\d{1,3})?/

function amount(value: string): number | null {
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && Math.abs(parsed) <= MAX_AMOUNT ? parsed : null
}

function scenario(values: number[], offset: number): ForesightScenarioValues {
  return {
    annualCashFlow: values[offset]!,
    cashSurrenderValue: values[offset + 1]!,
    netDeathBenefit: values[offset + 2]!,
  }
}

export function parseForesightSummaryOfValuesText(text: string): ForesightSummaryOfValues {
  const normalized = text.replace(/\s+/g, ' ')
  const rows: ForesightSummaryRow[] = []
  for (const match of normalized.matchAll(ROW)) {
    const policyYear = Number(match[1])
    const age = Number(match[2])
    if (policyYear < 1 || policyYear > MAX_POLICY_YEAR) continue
    const values = match[3]!.split(' ').map(amount)
    if (values.length !== 9 || values.some((value) => value === null)) continue
    if (rows.some((row) => row.policyYear === policyYear)) continue
    rows.push({
      policyYear,
      age,
      guaranteed: scenario(values as number[], 0),
      current: scenario(values as number[], 3),
    })
  }
  rows.sort((left, right) => left.policyYear - right.policyYear)

  if (rows.length < MINIMUM_ROWS) throw new Error('FORESIGHT_SUMMARY_OF_VALUES_MISSING')
  // Os anos não são contíguos aqui — a página marca 5, 10, 20 e o ano do
  // objetivo — mas a idade de emissão é a mesma em todas as linhas, e é isso
  // que prova que as linhas são do mesmo segurado e foram lidas em ordem.
  const issueAge = rows[0]!.age - rows[0]!.policyYear
  const consistent = rows.every((row, index) =>
    row.age - row.policyYear === issueAge &&
    (index === 0 || row.policyYear > rows[index - 1]!.policyYear))
  if (!consistent) throw new Error('FORESIGHT_SUMMARY_OF_VALUES_INCONSISTENT')

  const lapse = LAPSE.exec(normalized)
  const lapseYear = (index: 1 | 2) => {
    const raw = lapse?.[index]
    const parsed = raw === undefined ? Number.NaN : Number(raw)
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_POLICY_YEAR ? parsed : null
  }
  return { rows, lapseYear: { guaranteed: lapseYear(1), current: lapseYear(2) } }
}

export async function extractForesightSummaryOfValues(
  documentBytes: Uint8Array,
): Promise<ForesightSummaryOfValues> {
  const pages = await foresightPdfPages(documentBytes)
  const page = pages.find((candidate) =>
    /Summary of Values/.test(candidate) &&
    /Guaranteed Illustrated Values\s+Current Illustrated Values/.test(candidate))
  if (page === undefined) throw new Error('FORESIGHT_SUMMARY_OF_VALUES_MISSING')
  return parseForesightSummaryOfValuesText(page)
}
