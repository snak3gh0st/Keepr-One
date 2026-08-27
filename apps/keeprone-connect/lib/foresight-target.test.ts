import { describe, expect, it } from 'vitest'
import {
  FORESIGHT_FLEXLIFE_FIELDS,
  buildForesightTarget,
  compareForesightTarget,
  deterministicCaseFingerprint,
  foresightReadbackMismatchCode,
  validateForesightSurface,
  type ForesightMaterialReadback,
} from './foresight-target'
import { parseForesightIllustrationSnapshot } from './foresight-contract'

const snapshot = parseForesightIllustrationSnapshot({
  schemaVersion: 1,
  illustrationId: 'ill_123',
  caseId: 'case_123',
  carrierCaseName: 'KEEPRONE-TEST-20260826-ILL-123',
  insured: {
    firstName: 'KeeprOne',
    lastName: 'Test',
    dateOfBirth: '1990-01-01',
    issueState: 'FL',
  },
  product: { name: 'FlexLife', code: '956' },
  solve: { method: 'Specify_Amount', amount: 100_000 },
  faceAmount: 100_000,
  premium: { mode: 'Monthly', amount: 250 },
  underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
  deathBenefitOption: 'A_Level',
  allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
  riders: [
    'DeathBenefitProtection',
    'ABRTerminalIllness',
    'ABRChronicIllness',
    'ABRCriticalIllness',
    'ABRCriticalInjury',
    'ABRAlzheimersDisease',
  ],
  reports: ['NAIC_ILLUSTRATION'],
})!

describe('Foresight target verification', () => {
  it('accepts only the observed FlexLife page inventory', () => {
    expect(validateForesightSurface({
      path: '/NWI/IUL2025/client.aspx',
      fieldIds: Object.values(FORESIGHT_FLEXLIFE_FIELDS.client),
    })).toEqual({ ok: true, surface: 'CLIENT' })
    expect(validateForesightSurface({
      path: '/NWI/IUL2025/client.aspx',
      fieldIds: Object.values(FORESIGHT_FLEXLIFE_FIELDS.client).filter((id) =>
        id !== FORESIGHT_FLEXLIFE_FIELDS.client.birthDate),
    })).toEqual({ ok: false, code: 'FORESIGHT_SCHEMA_MISMATCH' })
    expect(validateForesightSurface({
      path: '/NWI/IUL2026/client.aspx',
      fieldIds: Object.values(FORESIGHT_FLEXLIFE_FIELDS.client),
    })).toEqual({ ok: false, code: 'FORESIGHT_PATH_UNEXPECTED' })
  })

  it('builds the exact material target in carrier display formats', () => {
    expect(buildForesightTarget(snapshot)).toEqual({
      carrierCaseName: 'KEEPRONE-TEST-20260826-ILL-123',
      firstName: 'KeeprOne',
      lastName: 'Test',
      dateOfBirth: '01/01/1990',
      issueState: 'FL',
      productCode: '956',
      solveMethod: 'Specify_Amount',
      solveAmount: 100_000,
      faceAmount: 100_000,
      premiumMode: 'Monthly',
      premiumAmount: 250,
      gender: 'Male',
      rateClass: 'Standard_NT',
      deathBenefitOption: 'A_Level',
      allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
      riders: [
        'DeathBenefitProtection',
        'ABRTerminalIllness',
        'ABRChronicIllness',
        'ABRCriticalIllness',
        'ABRCriticalInjury',
        'ABRAlzheimersDisease',
      ],
      reports: ['NAIC_ILLUSTRATION'],
    })
  })

  it('accepts formatting differences but not a material mismatch', () => {
    const observed: ForesightMaterialReadback = {
      ...buildForesightTarget(snapshot),
      solveAmount: '$100,000.00',
      dateOfBirth: '1/1/1990',
    }
    expect(compareForesightTarget(snapshot, observed)).toEqual({ ok: true })
    expect(compareForesightTarget(snapshot, { ...observed, issueState: 'GA' })).toEqual({
      ok: false,
      mismatches: ['issueState'],
    })
    expect(foresightReadbackMismatchCode(['issueState'])).toBe('FORESIGHT_READBACK_ISSUE_STATE_MISMATCH')
    expect(foresightReadbackMismatchCode(['premiumAmount'])).toBe('FORESIGHT_READBACK_PREMIUM_AMOUNT_MISMATCH')
    expect(foresightReadbackMismatchCode([])).toBe('FORESIGHT_READBACK_MISMATCH')
  })

  it('uses only non-PII identifiers in the receipt fingerprint', async () => {
    const fingerprint = await deterministicCaseFingerprint(snapshot)
    expect(fingerprint).toMatch(/^case_[a-f0-9]{64}$/)
    expect(fingerprint).not.toContain('KeeprOne')
    expect(fingerprint).not.toContain('1990')
  })
})
