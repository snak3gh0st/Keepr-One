import type { ApplicationDossierDraftV2 } from './dossier-contract'
import { parseApplicationDossierDraftV2 } from './dossier-contract'
import {
  buildForesightIllustrationSnapshot,
  foresightIllustrationInputHash,
} from '@/lib/national-life/foresight-illustration-contract'
import {
  buildForesightTermIllustrationSnapshot,
  foresightTermIllustrationInputHash,
} from '@/lib/national-life/foresight-term-contract'

export type ApplicationIllustrationSource = {
  id: string
  caseId: string | null
  createdAt: Date
  productName: string | null
  rawPayload: unknown
  documentReady: boolean
  faceAmount: number | null
  premium: number | null
}

export type ApplicationFromIllustrationSeed = {
  prospect: {
    firstName: string
    lastName: string
    dateOfBirth: Date
    state: string
    tobaccoStatus: 'YES' | 'NO'
  }
  insuranceCase: {
    productType: 'TERM' | 'IUL'
    targetCoverage: number
    monthlyBudget: number
  }
  dossier: ApplicationDossierDraftV2
}

export class ApplicationFromIllustrationError extends Error {
  constructor(readonly code: 'ILLUSTRATION_NOT_OFFICIAL' | 'ILLUSTRATION_RESULT_MISSING' | 'ILLUSTRATION_CASE_MISMATCH') {
    super(code)
  }
}

function officialNumber(value: number | null): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    throw new ApplicationFromIllustrationError('ILLUSTRATION_RESULT_MISSING')
  }
  return value
}

export function buildApplicationFromIllustrationSeed(
  source: ApplicationIllustrationSource,
  caseId: string,
): ApplicationFromIllustrationSeed {
  if (!source.documentReady) throw new ApplicationFromIllustrationError('ILLUSTRATION_NOT_OFFICIAL')
  if (source.caseId && source.caseId !== caseId) {
    throw new ApplicationFromIllustrationError('ILLUSTRATION_CASE_MISMATCH')
  }

  const faceAmount = officialNumber(source.faceAmount)
  const plannedPremium = officialNumber(source.premium)
  const linkedSource = { ...source, caseId }

  if (source.productName === 'NL Term' || source.productName === 'LSW Term') {
    const snapshot = buildForesightTermIllustrationSnapshot(linkedSource)
    if (snapshot.faceAmount !== faceAmount) {
      throw new ApplicationFromIllustrationError('ILLUSTRATION_RESULT_MISSING')
    }
    const carrierPrefix = snapshot.product.carrierName === 'LSW Term' ? 'LSW' : 'NL'
    const dossier = parseApplicationDossierDraftV2({
      version: 2,
      insured: {
        firstName: snapshot.insured.firstName,
        lastName: snapshot.insured.lastName,
        birthDate: snapshot.insured.dateOfBirth,
        sexAtBirth: snapshot.underwriting.gender === 'Female' ? 'FEMALE' : 'MALE',
      },
      address: { state: snapshot.insured.issueState },
      coverage: {
        family: 'TERM',
        carrierProduct: `${carrierPrefix} ${snapshot.termDuration}`,
        termDuration: snapshot.termDuration,
        issueState: snapshot.insured.issueState,
        applicationType: 'FULL',
        illustrationId: source.id,
        illustrationInputHash: foresightTermIllustrationInputHash(snapshot),
        faceAmount,
        premiumMode: 'MONTHLY',
        plannedPremium,
      },
    })
    return {
      prospect: {
        firstName: snapshot.insured.firstName,
        lastName: snapshot.insured.lastName,
        dateOfBirth: new Date(`${snapshot.insured.dateOfBirth}T00:00:00.000Z`),
        state: snapshot.insured.issueState,
        tobaccoStatus: snapshot.underwriting.rateClass === 'Standard_Tobacco' ? 'YES' : 'NO',
      },
      insuranceCase: { productType: 'TERM', targetCoverage: faceAmount, monthlyBudget: plannedPremium },
      dossier,
    }
  }

  const snapshot = buildForesightIllustrationSnapshot(linkedSource)
  const dossier = parseApplicationDossierDraftV2({
    version: 2,
    insured: {
      firstName: snapshot.insured.firstName,
      lastName: snapshot.insured.lastName,
      birthDate: snapshot.insured.dateOfBirth,
      sexAtBirth: snapshot.underwriting.gender === 'Female' ? 'FEMALE' : 'MALE',
    },
    address: { state: snapshot.insured.issueState },
    coverage: {
      family: 'IUL',
      carrierProduct: 'FlexLife (25)(LSW)',
      issueState: snapshot.insured.issueState,
      applicationType: 'FULL',
      illustrationId: source.id,
      illustrationInputHash: foresightIllustrationInputHash(snapshot),
      faceAmount,
      premiumMode: 'MONTHLY',
      plannedPremium,
    },
  })
  return {
    prospect: {
      firstName: snapshot.insured.firstName,
      lastName: snapshot.insured.lastName,
      dateOfBirth: new Date(`${snapshot.insured.dateOfBirth}T00:00:00.000Z`),
      state: snapshot.insured.issueState,
      tobaccoStatus: snapshot.underwriting.rateClass === 'Standard_Tobacco' ? 'YES' : 'NO',
    },
    insuranceCase: { productType: 'IUL', targetCoverage: faceAmount, monthlyBudget: plannedPremium },
    dossier,
  }
}
