import { expect, it } from 'vitest'
import type { ForesightSolvedIllustrationSnapshotV2 } from './foresight-contract'
import { solvedClientMatches } from './foresight-executor'

it('accepts the US birth date read back from the solved Foresight client form', () => {
  const snapshot = {
    schemaVersion: 2,
    illustrationId: 'ill_capital_123',
    caseId: null,
    carrierCaseName: 'KEEPRONE-TEST-20260827-CAPITAL123',
    insured: {
      firstName: 'Keeprone',
      lastName: 'Teste Capital',
      dateOfBirth: '1981-08-26',
      issueState: 'FL',
    },
    product: { name: 'FlexLife', code: '956' },
    solve: { basis: 'DEATH_BENEFIT', method: 'Protection_Focus', amount: 250_000 },
    faceAmount: 250_000,
    premium: { mode: 'Monthly', amount: null },
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
  } as const satisfies ForesightSolvedIllustrationSnapshotV2

  expect(solvedClientMatches(snapshot, {
    firstName: 'Keeprone',
    lastName: 'Teste Capital',
    dateOfBirth: '08/26/1981',
    issueState: 'FL',
    gender: 'Male',
    rateClass: 'Standard_NT',
  })).toBe(true)
})
