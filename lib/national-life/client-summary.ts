/// The few facts that may travel to the insured, read back from an
/// illustration National Life has already confirmed.
///
/// This is deliberately the narrowest reading of `rawPayload` in the codebase.
/// Everything the agent's screen shows — target premium, the agent's original
/// request, the carrier's own adjustment of it, the rate assumptions — is left
/// behind here. What survives is what a client can act on: what they are
/// covered for, what they pay, and how it moves.
///
/// Nothing is invented. Every number returned is one the carrier produced and
/// K-Bot verified against the official PDF; this module only selects, arranges,
/// and — in the one place it adds up a column — refuses to do so unless the
/// addition is honest. It holds no words: labels and language belong to the
/// renderer, so the same facts can be presented in either language.

import { flexLifeProductLabel } from './flex-life'
import type { ForesightTermLedger, ForesightTermLedgerRow } from './foresight-term-ledger'
import type { ForesightGuaranteedLedger } from './foresight-guaranteed-ledger'
import type { ForesightSummaryOfValues } from './foresight-summary-of-values'
import { foresightQuickReview, verifiedForesightResult } from './illustration-verified-result'

/// Years worth calling out beside the curve. 5 and 10 are the near horizon a
/// client can picture, 20 is where a permanent policy starts to look unlike a
/// term one, and the carrier's last projected year is the endgame.
const MILESTONE_YEARS = [5, 10, 20]

/// The denser table in the full presentation. Same reasoning, more rungs.
const FULL_MILESTONE_YEARS = [1, 5, 10, 15, 20, 25, 30]

/// The age a client is usually deciding *towards*. When the projection reaches
/// it, the outlook is reported there; otherwise at the last year the carrier
/// projected, which is the only other age this illustration actually speaks to.
const OUTLOOK_AGE = 65

/// How many rungs of the Term premium schedule the one-pager prints. Enough to
/// show the shape of the climb; few enough that the page stays a letter.
const TERM_SCHEDULE_ROWS = 6

/// Two points make a line. One makes a claim with nothing to read it against,
/// so a projection that short produces no summary at all.
const MINIMUM_COVERAGE_POINTS = 2

export const TERM_DURATIONS = ['10-G', '15-G', '20-G', '30-G', 'ART'] as const
export type TermDuration = (typeof TERM_DURATIONS)[number]

export type ClientSummaryPoint = {
  policyYear: number
  age: number
  netDeathBenefit: number
  cashSurrenderValue: number | null
  premiumOutlay: number | null
  accumulatedValue: number | null
}

/// What was paid in against what it became, at one stated age.
///
/// Present only when both halves are honest: see `totalContributions`.
export type ClientSummaryOutlook = {
  age: number
  policyYear: number
  totalContributions: number
  accumulatedValue: number
  growth: number
}

type ClientSummaryBase = {
  insuredName: string
  productLabel: string
  faceAmount: number
  monthlyPremium: number
  annualPremium: number
  issuedOn: Date
  advisorName: string | null
}

/// Two shapes because the carrier returns two genuinely different things, and
/// the renderer must branch on which rather than infer it from an empty array.
/// A Term result carries four numbers and a duration; there is no projection to
/// draw, and drawing a shape anyway would be this page inventing the one thing
/// it exists to avoid inventing.
export type ClientSummary =
  | (ClientSummaryBase & {
      kind: 'PROJECTED'
      coverage: ClientSummaryPoint[]
      milestones: ClientSummaryPoint[]
      fullMilestones: ClientSummaryPoint[]
      outlook: ClientSummaryOutlook | null
      lapseYear: number | null
      mecYear: number | null
      /// The same policy on guaranteed assumptions — the minimum rate the
      /// carrier credits and the maximum charges it may take. Empty when the
      /// official PDF could not be read, which keeps the document that shipped
      /// before this existed: current values alone, marked as not guaranteed.
      guaranteed: ClientSummaryPoint[]
      /// Where the carrier says the policy ends on those assumptions. This is
      /// the fact a current-values-only page cannot state and the one a client
      /// most needs, so it is carried separately from the curve that leads to
      /// it — a chart can be skipped; a sentence is read.
      guaranteedLapse: { policyYear: number; age: number } | null
      /// Os dois cenários lado a lado, exatamente como a página Summary of
      /// Values da ilustração oficial os apresenta. Quando existe, é daqui que
      /// saem tanto a tabela quanto o gráfico — os mesmos números, desenhados e
      /// escritos, em vez de um desenho que o leitor não consegue conferir.
      scenarios: ClientSummaryScenarios | null
    })

  | (ClientSummaryBase & {
      kind: 'LEVEL_TERM'
      termDuration: TermDuration
      /// The guaranteed premium schedule, when the official PDF could be read.
      /// Null keeps the document that shipped before this existed: duration
      /// stated, schedule omitted. Present, it is the carrier's own ledger.
      schedule: ClientSummaryTermSchedule | null
    })

export type ClientSummaryScenarioPoint = {
  policyYear: number
  age: number
  cashSurrenderValue: number
  netDeathBenefit: number
}

export type ClientSummaryScenarios = {
  rows: Array<{
    policyYear: number
    age: number
    guaranteed: { cashSurrenderValue: number; netDeathBenefit: number }
    current: { cashSurrenderValue: number; netDeathBenefit: number }
  }>
  /// O ano em que a apólice se encerra em cada cenário. O corrente também
  /// encerra, e é o número que uma peça só-corrente nunca conta.
  lapseYear: { guaranteed: number | null; current: number | null }
  /// A idade correspondente a cada encerramento, para o gráfico saber onde
  /// parar cada curva.
  lapseAge: { guaranteed: number | null; current: number | null }
}

/// What the Term ledger says, reduced to what a client is deciding about.
///
/// The level period is counted from the ledger, not taken from the product
/// name, so a policy whose premium behaves differently from its label reports
/// what it actually does.
export type ClientSummaryTermSchedule = {
  levelPeriodYears: number
  levelAnnualPremium: number
  levelMonthlyPremium: number
  deathBenefit: number
  finalPolicyYear: number
  finalAge: number
  firstIncrease: {
    policyYear: number
    age: number
    annualPremium: number
    monthlyPremium: number
  } | null
  rows: ForesightTermLedgerRow[]
}

export type IllustrationForClientSummary = {
  insuredName: string | null
  productName: string | null
  documentFetchedAt: Date | null
  documentMimeType: string | null
  rawPayload: unknown
  /// The Term ledger read from the official PDF, when the caller went and read
  /// it. Optional because the agent's own screen builds this summary only to
  /// ask whether a document exists, and has no reason to parse a PDF for that.
  termLedger?: ForesightTermLedger | null
  /// The guaranteed ledger read from the official PDF, on the same terms.
  guaranteedLedger?: ForesightGuaranteedLedger | null
  /// A página Summary of Values do PDF oficial, quando pôde ser lida.
  summaryOfValues?: ForesightSummaryOfValues | null
  /// The agent this goes out under. Optional because the summary is complete
  /// without it — the page simply omits the advisor block rather than printing
  /// a placeholder where a person's name belongs.
  advisorName?: string | null
}

export function buildClientSummary(illustration: IllustrationForClientSummary): ClientSummary | null {
  // The same two conditions the agent's own screen calls `resultVerified`. A
  // client-facing artifact is the last place that should relax them, and Term
  // clears them the same way: its own result only counts when it came from the
  // official PDF in monthly mode.
  const documentReady = illustration.documentFetchedAt !== null &&
    illustration.documentMimeType === 'application/pdf'
  const result = verifiedForesightResult(illustration.rawPayload)
  if (!documentReady || !result) return null

  const base: ClientSummaryBase = {
    // An empty header line is worse than a generic one: it reads as a document
    // that was assembled wrong, on the one page the client actually keeps.
    insuredName: illustration.insuredName?.trim() || 'Prepared for you',
    productLabel: flexLifeProductLabel(illustration.productName),
    faceAmount: result.confirmedFaceAmount,
    monthlyPremium: result.confirmedMonthlyPremium,
    annualPremium: result.confirmedAnnualPremium,
    issuedOn: illustration.documentFetchedAt!,
    advisorName: illustration.advisorName?.trim() || null,
  }

  const quickReview = foresightQuickReview(illustration.rawPayload)
  if (!quickReview) return termSummary(illustration, base)

  const coverage = quickReview.annualProjection
    .filter((row): row is typeof row & { netDeathBenefit: number } => row.netDeathBenefit !== null)
    .map((row) => ({
      policyYear: row.policyYear,
      age: row.age,
      netDeathBenefit: row.netDeathBenefit,
      cashSurrenderValue: row.cashSurrenderValue,
      premiumOutlay: row.premiumOutlay,
      accumulatedValue: row.accumulatedValue,
    }))
    .sort((left, right) => left.policyYear - right.policyYear)
  if (coverage.length < MINIMUM_COVERAGE_POINTS) return null

  const lastYear = coverage[coverage.length - 1]!.policyYear

  return {
    ...base,
    kind: 'PROJECTED',
    coverage,
    milestones: pickMilestones(coverage, [...MILESTONE_YEARS, lastYear]),
    fullMilestones: pickMilestones(coverage, [...FULL_MILESTONE_YEARS, lastYear]),
    outlook: outlookFrom(coverage),
    lapseYear: quickReview.summary.lapseYear,
    mecYear: quickReview.summary.mecYear,
    guaranteed: guaranteedCoverage(illustration.guaranteedLedger ?? null),
    guaranteedLapse: illustration.guaranteedLedger?.lapse ?? null,
    scenarios: scenariosFrom(illustration.summaryOfValues ?? null),
  }
}

/// A idade de emissão é a mesma em todas as linhas da página, então a idade de
/// um ano qualquer — inclusive um ano de encerramento que não aparece como
/// linha — sai de somá-la ao ano.
function scenariosFrom(summary: ForesightSummaryOfValues | null): ClientSummaryScenarios | null {
  if (!summary || summary.rows.length === 0) return null
  const issueAge = summary.rows[0]!.age - summary.rows[0]!.policyYear
  const ageFor = (year: number | null) => year === null ? null : issueAge + year
  return {
    rows: summary.rows.map((row) => ({
      policyYear: row.policyYear,
      age: row.age,
      guaranteed: {
        cashSurrenderValue: row.guaranteed.cashSurrenderValue,
        netDeathBenefit: row.guaranteed.netDeathBenefit,
      },
      current: {
        cashSurrenderValue: row.current.cashSurrenderValue,
        netDeathBenefit: row.current.netDeathBenefit,
      },
    })),
    lapseYear: summary.lapseYear,
    lapseAge: {
      guaranteed: ageFor(summary.lapseYear.guaranteed),
      current: ageFor(summary.lapseYear.current),
    },
  }
}

function guaranteedCoverage(ledger: ForesightGuaranteedLedger | null): ClientSummaryPoint[] {
  if (!ledger) return []
  return ledger.rows.map((row) => ({
    policyYear: row.policyYear,
    age: row.age,
    netDeathBenefit: row.netDeathBenefit,
    cashSurrenderValue: row.cashSurrenderValue,
    premiumOutlay: row.premiumOutlay,
    accumulatedValue: row.accumulatedValue,
  }))
}

function pickMilestones(coverage: ClientSummaryPoint[], years: number[]): ClientSummaryPoint[] {
  return [...new Set(years)]
    .sort((a, b) => a - b)
    .map((year) => coverage.find((point) => point.policyYear === year))
    .filter((point): point is ClientSummaryPoint => point !== undefined)
}

/// Total paid in against total accumulated, at one age.
///
/// The addition is the only arithmetic in this module, and it is guarded twice.
/// A Quick View that samples years — 1, 5, 10, 20 — would sum to a fraction of
/// what was really paid, and that fraction would be printed as "total
/// contributions", which is worse than printing nothing. So the sum happens
/// only when the projection is every consecutive year from the first, and only
/// when every one of those years states its outlay.
function outlookFrom(coverage: ClientSummaryPoint[]): ClientSummaryOutlook | null {
  const contiguous = coverage.every((point, index) =>
    point.policyYear === coverage[0]!.policyYear + index)
  if (!contiguous) return null

  const target = coverage.find((point) => point.age === OUTLOOK_AGE) ??
    [...coverage].reverse().find((point) => point.accumulatedValue !== null)
  if (!target || target.accumulatedValue === null) return null

  const paidIn = coverage.filter((point) => point.policyYear <= target.policyYear)
  if (paidIn.some((point) => point.premiumOutlay === null)) return null

  const totalContributions = paidIn.reduce((sum, point) => sum + point.premiumOutlay!, 0)
  return {
    age: target.age,
    policyYear: target.policyYear,
    totalContributions,
    accumulatedValue: target.accumulatedValue,
    growth: target.accumulatedValue - totalContributions,
  }
}

function termSummary(
  illustration: IllustrationForClientSummary,
  base: ClientSummaryBase,
): ClientSummary | null {
  const payload = illustration.rawPayload as {
    foresightTermDraft?: { termDuration?: unknown }
    foresightTermResult?: { confirmedTermDuration?: unknown }
  }
  // Term results written before duration reconciliation existed carry no
  // confirmed duration. `resolveForesightTermDurationResult` — the canonical
  // reader — treats those rows as confirming the duration that was requested,
  // because back then the carrier had no way to return a different one; the
  // agent's own screen prints it as the confirmed term. Refusing them here made
  // this module stricter than the rest of the app about the same illustration,
  // which showed up in production as a verified Term policy that could be
  // opened but not summarised, with nothing on screen explaining why.
  const duration = payload?.foresightTermResult?.confirmedTermDuration ??
    payload?.foresightTermDraft?.termDuration
  if (!isTermDuration(duration)) return null

  return {
    ...base,
    kind: 'LEVEL_TERM',
    termDuration: duration,
    schedule: termSchedule(illustration.termLedger ?? null),
  }
}

/// The carrier annualizes the guaranteed premium at the mode that was quoted,
/// which is why a monthly-mode Term ledger divides back to the exact monthly
/// figure printed on its own cover. Dividing is restating the carrier's own
/// relationship between the two, not converting between modes.
const MONTHS_PER_YEAR = 12

function termSchedule(ledger: ForesightTermLedger | null): ClientSummaryTermSchedule | null {
  if (!ledger) return null
  const last = ledger.rows[ledger.rows.length - 1]!
  const increase = ledger.firstIncrease
  return {
    levelPeriodYears: ledger.levelPeriodYears,
    levelAnnualPremium: ledger.levelAnnualPremium,
    levelMonthlyPremium: ledger.levelAnnualPremium / MONTHS_PER_YEAR,
    deathBenefit: ledger.rows[0]!.guaranteedDeathBenefit,
    finalPolicyYear: last.policyYear,
    finalAge: last.age,
    firstIncrease: increase === null ? null : {
      ...increase,
      monthlyPremium: increase.annualPremium / MONTHS_PER_YEAR,
    },
    rows: termScheduleRows(ledger),
  }
}

/// The rungs worth printing: where the level premium starts, where it ends,
/// what it becomes the year after, and then a widening walk to the end of the
/// contract. The two years on either side of the guarantee are the point of
/// the table, so they are chosen first and the rest fills in around them.
function termScheduleRows(ledger: ForesightTermLedger): ForesightTermLedgerRow[] {
  const last = ledger.rows[ledger.rows.length - 1]!
  const anchors = [1, ledger.levelPeriodYears, ledger.levelPeriodYears + 1]
  const walk: number[] = []
  for (let year = ledger.levelPeriodYears + 6; year < last.policyYear; year += 5) walk.push(year)
  const years = [...new Set([...anchors, ...walk, last.policyYear])]
    .filter((year) => year >= 1 && year <= last.policyYear)
    .sort((a, b) => a - b)
  // When the contract runs long there are more rungs than fit. Thinning from
  // the far end keeps the years the client is actually deciding about.
  while (years.length > TERM_SCHEDULE_ROWS) years.splice(years.length - 2, 1)
  return years
    .map((year) => ledger.rows.find((row) => row.policyYear === year))
    .filter((row): row is ForesightTermLedgerRow => row !== undefined)
}

function isTermDuration(value: unknown): value is TermDuration {
  return typeof value === 'string' && (TERM_DURATIONS as readonly string[]).includes(value)
}
