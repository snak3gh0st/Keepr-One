import {
  buildForesightIllustrationSnapshot,
  foresightIllustrationInputHash,
} from '@/lib/national-life/foresight-illustration-contract'
import {
  buildForesightTermIllustrationSnapshot,
  foresightTermIllustrationInputHash,
} from '@/lib/national-life/foresight-term-contract'

type IllustrationSource = {
  id: string
  caseId: string | null
  createdAt: Date
  productName: string | null
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
    const expectedCarrier = target.carrierProduct.startsWith('NL ') ? 'NL Term'
      : target.carrierProduct.startsWith('LSW ') ? 'LSW Term' : mismatch()
    if (snapshot.product.carrierName !== expectedCarrier ||
      snapshot.termDuration !== target.termDuration ||
      snapshot.insured.issueState !== target.issueState ||
      (target.faceAmount !== undefined && snapshot.faceAmount !== target.faceAmount)) mismatch()
    return {
      illustrationId: source.id,
      illustrationInputHash: foresightTermIllustrationInputHash(snapshot),
    }
  }

  if (target.carrierProduct !== 'FlexLife (25)(LSW)' || source.productName !== 'FlexLife') mismatch()
  const snapshot = buildForesightIllustrationSnapshot(source)
  if (snapshot.insured.issueState !== target.issueState ||
    (target.faceAmount !== undefined && snapshot.faceAmount !== null && snapshot.faceAmount !== target.faceAmount) ||
    (target.plannedPremium !== undefined && target.premiumMode === 'MONTHLY' &&
      snapshot.premium.amount !== null && snapshot.premium.amount !== target.plannedPremium)) mismatch()
  return {
    illustrationId: source.id,
    illustrationInputHash: foresightIllustrationInputHash(snapshot),
  }
}
