/// The few numbers that may travel to the insured, read back from an
/// illustration National Life has already confirmed.
///
/// This is deliberately the narrowest reading of `rawPayload` in the codebase.
/// Everything the agent's screen shows — target premium, the agent's original
/// request, the carrier's own adjustment of it, the rate assumptions, 121 rows
/// of projection — is left behind here. What survives is what a client can act
/// on: what they are covered for, what they pay, and how long it lasts.
///
/// Nothing is computed. Every number returned is one the carrier produced and
/// K-Bot verified against the official PDF; this module only selects and
/// arranges. If a value is not in the verified payload, the summary does not
/// exist rather than being filled in from an estimate.

import { flexLifeProductLabel } from './flex-life'
import { foresightQuickReview, verifiedForesightResult } from './illustration-verified-result'

/// Years worth calling out next to the curve. 5 and 10 are the near horizon a
/// client can picture, 20 is where a permanent policy starts to look unlike a
/// term one, and the carrier's last projected year is the endgame. Anything
/// denser belongs in the official PDF, which is one click away.
const MILESTONE_YEARS = [5, 10, 20]

/// Two points make a line. One makes a claim with nothing to read it against,
/// so a projection that short produces no summary at all.
const MINIMUM_COVERAGE_POINTS = 2

/// What each confirmed Term duration actually promises, in the client's words.
///
/// These restate `confirmedTermDuration` and nothing more. `-G` names the
/// period the premium is guaranteed level for — not a date the cover stops, so
/// the wording never says one. `ART` is annually renewable, whose defining
/// property is the opposite of level, and saying so is the single most useful
/// thing this page can tell someone holding one.
const TERM_DURATION_COPY: Record<string, string> = {
  '10-G': 'Level premium guaranteed for 10 years',
  '15-G': 'Level premium guaranteed for 15 years',
  '20-G': 'Level premium guaranteed for 20 years',
  '30-G': 'Level premium guaranteed for 30 years',
  ART: 'Annually renewable — the premium increases each year',
}

export type ClientSummaryPoint = {
  policyYear: number
  age: number
  netDeathBenefit: number
  cashSurrenderValue: number | null
}

type ClientSummaryBase = {
  insuredName: string
  productLabel: string
  faceAmount: number
  monthlyPremium: number
  annualPremium: number
  issuedOn: Date
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
    })
  | (ClientSummaryBase & {
      kind: 'LEVEL_TERM'
      durationLabel: string
    })

export type IllustrationForClientSummary = {
  insuredName: string | null
  productName: string | null
  documentFetchedAt: Date | null
  documentMimeType: string | null
  rawPayload: unknown
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
    }))
    .sort((left, right) => left.policyYear - right.policyYear)
  if (coverage.length < MINIMUM_COVERAGE_POINTS) return null

  const lastYear = coverage[coverage.length - 1]!.policyYear
  const milestoneYears = [...new Set([...MILESTONE_YEARS, lastYear])].sort((a, b) => a - b)
  const milestones = milestoneYears
    .map((year) => coverage.find((point) => point.policyYear === year))
    .filter((point): point is ClientSummaryPoint => point !== undefined)

  return { ...base, kind: 'PROJECTED', coverage, milestones }
}

function termSummary(
  illustration: IllustrationForClientSummary,
  base: ClientSummaryBase,
): ClientSummary | null {
  // Read from the official result itself rather than through
  // `resolveForesightTermDurationResult`. That function rebuilds the whole
  // request snapshot to report whether the carrier *changed* the duration —
  // a reconciliation the agent's screen shows and the client's page does not,
  // and one that would need this module to carry the illustration id and case
  // id it has no other use for. What a client is owed is what the carrier
  // confirmed, which lives in the same object, behind the same `OFFICIAL_PDF`
  // guard, as the premiums already trusted above.
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
  const durationLabel = typeof duration === 'string' ? TERM_DURATION_COPY[duration] : undefined
  if (!durationLabel) return null

  return { ...base, kind: 'LEVEL_TERM', durationLabel }
}
