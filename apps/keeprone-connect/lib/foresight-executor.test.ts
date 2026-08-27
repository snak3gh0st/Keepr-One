import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ForesightSolvedIllustrationSnapshotV2 } from './foresight-contract'
import { monthlyPremiumFromAnnual, solvedClientMatches } from './foresight-executor'

it('primes a new solved illustration allocation before asking Foresight to calculate', () => {
  const source = readFileSync(new URL('./foresight-executor.ts', import.meta.url), 'utf8')
  const workflow = source.slice(
    source.indexOf('async function executeForesightSolvedIllustration'),
    source.indexOf('export async function executeForesightIllustration'),
  )

  expect(workflow.indexOf("navigate('/NWI/IUL2025/InterestRates.aspx'")).toBeLessThan(
    workflow.indexOf("navigate('/NWI/IUL2025/ledger.aspx'"),
  )
})

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

it('derives the monthly solved premium from the carrier annual summary', () => {
  expect(monthlyPremiumFromAnnual(2_758)).toBe(229.83)
})
