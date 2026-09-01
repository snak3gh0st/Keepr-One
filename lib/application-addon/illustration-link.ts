import {
  buildForesightIllustrationSnapshot,
  foresightIllustrationInputHash,
} from '@/lib/national-life/foresight-illustration-contract'
import {
  buildForesightTermIllustrationSnapshot,
  foresightTermIllustrationInputHash,
  resolveForesightTermDurationResult,
} from '@/lib/national-life/foresight-term-contract'

type IllustrationSource = {
  id: string
  caseId: string | null
  createdAt: Date
  productName: string | null
  faceAmount?: number | null
  premium?: number | null
  rawPayload: unknown
}

type ApplicationIllustrationTarget = {
  family: 'IUL' | 'TERM'
  carrierProduct: string
  termDuration?: string
  issueState: string
  expectedCaseId?: string
  faceAmount?: number
  plannedPremium?: number
  premiumMode?: 'MONTHLY' | 'ANNUAL'
}

function mismatch(): never {
  throw new Error('APPLICATION_ILLUSTRATION_MISMATCH')
}

export function resolveApplicationIllustrationLink(
  source: IllustrationSource,
  target: ApplicationIllustrationTarget,
): { illustrationId: string; illustrationInputHash: string } {
  if (target.expectedCaseId && source.caseId !== target.expectedCaseId) mismatch()

  if (target.family === 'TERM') {
    const snapshot = buildForesightTermIllustrationSnapshot(source)
    const durationResult = resolveForesightTermDurationResult(source)
    const expectedCarrier = target.carrierProduct.startsWith('NL ') ? 'NL Term'
      : target.carrierProduct.startsWith('LSW ') ? 'LSW Term' : mismatch()
    if (snapshot.product.carrierName !== expectedCarrier ||
      durationResult.confirmedTermDuration !== target.termDuration ||
      snapshot.insured.issueState !== target.issueState ||
      (target.faceAmount !== undefined && (source.faceAmount ?? snapshot.faceAmount) !== target.faceAmount) ||
      (target.plannedPremium !== undefined && source.premium != null && source.premium !== target.plannedPremium) ||
      (target.premiumMode !== undefined && target.premiumMode !== 'MONTHLY')) mismatch()
    return {
      illustrationId: source.id,
      illustrationInputHash: foresightTermIllustrationInputHash(snapshot),
    }
  }

  if (target.carrierProduct !== 'FlexLife (25)(LSW)' || source.productName !== 'FlexLife') mismatch()
  const snapshot = buildForesightIllustrationSnapshot(source)
  if (snapshot.insured.issueState !== target.issueState ||
    (target.faceAmount !== undefined && (source.faceAmount ?? snapshot.faceAmount) !== null &&
      (source.faceAmount ?? snapshot.faceAmount) !== target.faceAmount) ||
    (target.plannedPremium !== undefined && target.premiumMode === 'MONTHLY' &&
      (source.premium ?? snapshot.premium.amount) !== null &&
      (source.premium ?? snapshot.premium.amount) !== target.plannedPremium)) mismatch()
  return {
    illustrationId: source.id,
    illustrationInputHash: foresightIllustrationInputHash(snapshot),
  }
}
