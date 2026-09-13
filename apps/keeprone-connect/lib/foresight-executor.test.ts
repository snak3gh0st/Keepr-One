import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ForesightSolvedIllustrationSnapshotV2 } from './foresight-contract'
import {
  carrierSummaryAmount,
  parseForesightQuickReview,
  quickReviewMatchesLedger,
  quickViewInitialFaceAmount,
  monthlyPremiumFromAnnual,
  solvedClientMatches,
  solvedLedgerMatches,
} from './foresight-executor'

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

// Two different things used to fail as one here, and it cost a whole
// generation: the carrier contradicting itself, and a second opinion that
// simply did not arrive. Which columns Quick View renders depends on how the
// case was solved, so a face-amount solve can legitimately produce nothing this
// reader accepts — while the ledger read back clean and the official PDF, the
// only authoritative document, was still ahead.
it('refuses a Quick Review that contradicts the ledger, not one it could not read', () => {
  const source = readFileSync(new URL('./foresight-executor.ts', import.meta.url), 'utf8')
  const workflow = source.slice(
    source.indexOf('async function executeForesightSolvedIllustration'),
    source.indexOf('export async function executeForesightIllustration'),
  )

  expect(workflow).toContain(
    "if ('review' in quickReview && !quickReviewMatchesLedger(quickReview.review, ledger)) {")
  expect(workflow).not.toContain('if (!quickReview ||')
  // The receipt names the Quick View only when it has one, and otherwise says
  // why it has none: the contract compares the key set exactly, so an undefined
  // value would invalidate it.
  expect(workflow).toContain("'review' in quickReview")
  expect(workflow).toContain('quickReviewUnavailable: quickReview.unavailable')
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

it('reads the solved death benefit from the exact National Life summary row', () => {
  const rows = [
    ['Target Premium:', '$1,200.00'],
    ['Premium:', '$1,200'],
    ['Net Death Benefit:', '$92,937'],
  ] as const

  expect(carrierSummaryAmount(rows, 'Net Death Benefit:')).toBe(92_937)
  expect(carrierSummaryAmount(rows, 'Premium:')).toBe(1_200)
  expect(carrierSummaryAmount(rows, 'Death Benefit:')).toBeNull()
})

it('reads the official solved face amount from Foresight Quick View', () => {
  const rows = [
    ['Initial Face Amount', 'Lapse Year', 'MEC Year', 'Modal Premium', 'Premium Mode'],
    ['$92,937', 'N/A', 'N/A', '$100.00', 'Monthly (EFT)'],
  ]

  expect(quickViewInitialFaceAmount(rows)).toBe(92_937)
  expect(quickViewInitialFaceAmount([['Initial Face Amount'], ['N/A']])).toBeNull()
})

it('captures Target Premium and the annual Quick View projection table', () => {
  const rows = [
    ['Initial Face Amount', 'Lapse Year', 'MEC Year', 'Modal Premium', 'Minimum Premium (MMP)', 'Death Benefit Protection Premium (MGP)', 'Target Premium', 'MEC Premium', 'Guideline Level Premium', 'Guideline Single Premium'],
    ['1300000', '0', '0', '2000', '6511.92', '6655.44', '18501.6', '87021', '23422', '375315'],
    [],
    ['Policy Year', 'Age', 'Premium Outlay', 'Weighted Average Interest Rate', 'Loan', 'Annual Income', 'Accumulated Value', 'Cash Surrender Value', 'Net Death Benefit'],
    ['1', '31', '24000', '5.89', '0', '0', '16088.19', '6088.19', '1316188.19'],
    ['2', '32', '24000', '5.95', '0', '0', '33008.24', '23008.24', '1333968.34'],
  ]

  expect(parseForesightQuickReview(rows)).toEqual({
    summary: {
      initialFaceAmount: 1_300_000,
      lapseYear: 0,
      mecYear: 0,
      modalPremium: 2_000,
      minimumPremium: 6_511.92,
      deathBenefitProtectionPremium: 6_655.44,
      targetPremium: 18_501.6,
      mecPremium: 87_021,
      guidelineLevelPremium: 23_422,
      guidelineSinglePremium: 375_315,
    },
    annualProjection: [
      { policyYear: 1, age: 31, premiumOutlay: 24_000, weightedAverageInterestRate: 5.89, loan: 0, annualIncome: 0, accumulatedValue: 16_088.19, cashSurrenderValue: 6_088.19, netDeathBenefit: 1_316_188.19 },
      { policyYear: 2, age: 32, premiumOutlay: 24_000, weightedAverageInterestRate: 5.95, loan: 0, annualIncome: 0, accumulatedValue: 33_008.24, cashSurrenderValue: 23_008.24, netDeathBenefit: 1_333_968.34 },
    ],
  })
})

it('blocks a Quick Review whose carrier values differ from the solved ledger', () => {
  const review = parseForesightQuickReview([
    ['Initial Face Amount', 'Target Premium', 'Modal Premium'],
    ['$1,300,000.00', '$18,501.60', '$2,000.00'],
    ['Policy Year', 'Age', 'Premium Outlay', 'Weighted Average Interest Rate', 'Loan', 'Annual Income', 'Accumulated Value', 'Cash Surrender Value', 'Net Death Benefit'],
    ['1', '31', '24000', '5.89', '0', '0', '16088.19', '6088.19', '1316188.19'],
  ])!

  expect(quickReviewMatchesLedger(review, { faceAmount: 1_300_000, monthlyPremium: 2_000 })).toBe(true)
  expect(quickReviewMatchesLedger(review, { faceAmount: 1_300_000, monthlyPremium: 2_001 })).toBe(false)
  expect(quickReviewMatchesLedger(review, { faceAmount: 1_299_999, monthlyPremium: 2_000 })).toBe(false)
})

it('rejects a Quick Review without the carrier modal premium', () => {
  expect(parseForesightQuickReview([
    ['Initial Face Amount', 'Target Premium'],
    ['$1,300,000.00', '$18,501.60'],
    ['Policy Year', 'Age', 'Premium Outlay', 'Weighted Average Interest Rate', 'Loan', 'Annual Income', 'Accumulated Value', 'Cash Surrender Value', 'Net Death Benefit'],
    ['1', '31', '24000', '5.89', '0', '0', '16088.19', '6088.19', '1316188.19'],
  ])).toBeNull()
})

// Which columns Quick View renders depends on the product and on what the case
// was solved for. Demanding all nine meant one absent column threw away the
// eight that were right there — and, because the caller reads a null as a
// read-back mismatch, failed the whole generation over it.
it('keeps the columns the carrier did render when one is missing', () => {
  const review = parseForesightQuickReview([
    ['Initial Face Amount', 'Target Premium', 'Modal Premium'],
    ['$1,300,000.00', '$18,501.60', '$2,000.00'],
    ['Policy Year', 'Age', 'Premium Outlay', 'Accumulated Value', 'Cash Surrender Value', 'Net Death Benefit'],
    ['1', '31', '24000', '16088.19', '6088.19', '1316188.19'],
  ])!

  expect(review.annualProjection[0]).toEqual({
    policyYear: 1, age: 31, premiumOutlay: 24_000,
    weightedAverageInterestRate: null, loan: null, annualIncome: null,
    accumulatedValue: 16_088.19, cashSurrenderValue: 6_088.19, netDeathBenefit: 1_316_188.19,
  })
})

// A row that cannot say which year it is is not a row.
it('rejects a projection table with no policy year or no age', () => {
  const header = ['Initial Face Amount', 'Target Premium', 'Modal Premium']
  const values = ['$1,300,000.00', '$18,501.60', '$2,000.00']
  expect(parseForesightQuickReview([
    header, values,
    ['Policy Year', 'Accumulated Value', 'Cash Surrender Value', 'Net Death Benefit'],
    ['1', '16088.19', '6088.19', '1316188.19'],
  ])).toBeNull()
  expect(parseForesightQuickReview([
    header, values,
    ['Age', 'Accumulated Value', 'Cash Surrender Value', 'Net Death Benefit'],
    ['31', '16088.19', '6088.19', '1316188.19'],
  ])).toBeNull()
})

// A summary table elsewhere on the page may carry a "Policy Year" cell. The
// projection is the candidate with the most columns Quick View is known to
// render, so a two-column aside cannot displace it.
it('picks the projection table over a narrower table that shares its headings', () => {
  const review = parseForesightQuickReview([
    ['Initial Face Amount', 'Target Premium', 'Modal Premium'],
    ['$1,300,000.00', '$18,501.60', '$2,000.00'],
    ['Policy Year', 'Age'],
    ['99', '99'],
    ['Policy Year', 'Age', 'Premium Outlay', 'Weighted Average Interest Rate', 'Loan', 'Annual Income', 'Accumulated Value', 'Cash Surrender Value', 'Net Death Benefit'],
    ['1', '31', '24000', '5.89', '0', '0', '16088.19', '6088.19', '1316188.19'],
  ])!

  expect(review.annualProjection).toHaveLength(1)
  expect(review.annualProjection[0]!.netDeathBenefit).toBe(1_316_188.19)
})

// Medido em produção: num solve guiado pelo capital, a National Life imprime
// Initial Face Amount, Lapse Year, MEC Year, Modal Premium e Premium Mode — e
// nenhum Target Premium, que é figura de solve por prêmio. O leitor exigia essa
// coluna para sequer localizar a tabela, e descartava o Quick View inteiro à
// espera de algo que nunca viria.
it('lê o resumo de um caso resolvido pelo capital, sem prêmio-alvo', () => {
  const review = parseForesightQuickReview([
    ['Initial Face Amount', 'Lapse Year', 'MEC Year', 'Modal Premium', 'Premium Mode'],
    ['$500,000.00', '', '', '$288.00', 'Monthly'],
    ['Policy Year', 'Age', 'Premium Outlay', 'Weighted Average Interest Rate', 'Accumulated Value', 'Cash Surrender Value', 'Net Death Benefit'],
    ['1', '36', '3456', '6.1', '1200', '0', '500000'],
  ])!

  expect(review.summary.initialFaceAmount).toBe(500_000)
  expect(review.summary.modalPremium).toBe(288)
  expect(review.summary.targetPremium).toBeNull()
  expect(review.annualProjection[0]).toMatchObject({
    policyYear: 1, age: 36, netDeathBenefit: 500_000, loan: null, annualIncome: null,
  })
  // O que ainda amarra a projeção ao caso que o ledger acabou de confirmar.
  expect(quickReviewMatchesLedger(review, { faceAmount: 500_000, monthlyPremium: 288 })).toBe(true)
  expect(quickReviewMatchesLedger(review, { faceAmount: 500_000, monthlyPremium: 289 })).toBe(false)
})

// O capital e o prêmio modal são o que amarram a tabela ao caso; sem eles não
// há como saber que a projeção é deste cenário.
it('ainda recusa um resumo sem capital ou sem prêmio modal', () => {
  expect(parseForesightQuickReview([
    ['Initial Face Amount', 'Lapse Year'],
    ['$500,000.00', ''],
    ['Policy Year', 'Age', 'Net Death Benefit'],
    ['1', '36', '500000'],
  ])).toBeNull()
})

it('accepts a carrier-confirmed adjustment after the approved input was written', () => {
  const snapshot = {
    schemaVersion: 2, illustrationId: 'ill_premium_123', caseId: null,
    carrierCaseName: 'KEEPRONE-TEST-20260827-PREMIUM123',
    insured: { firstName: 'Ale', lastName: 'Teste', dateOfBirth: '1998-03-12', issueState: 'FL' },
    product: { name: 'FlexLife', code: '956' },
    solve: { basis: 'PREMIUM', method: 'Based_on_Target_Premium', amount: 100 },
    faceAmount: null, premium: { mode: 'Monthly', amount: 100 },
    underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
    deathBenefitOption: 'A_Level',
    allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
    riders: ['DeathBenefitProtection', 'ABRTerminalIllness', 'ABRChronicIllness', 'ABRCriticalIllness', 'ABRCriticalInjury', 'ABRAlzheimersDisease'],
    reports: ['NAIC_ILLUSTRATION'],
  } as const satisfies ForesightSolvedIllustrationSnapshotV2

  expect(solvedLedgerMatches(snapshot, {
    faceSolve: 'Based on Target Premium', premiumSolve: 'None', faceAmount: 2_000_000,
    monthlyPremium: 105, annualPremium: 1_260, premiumMode: 'Monthly',
    deathBenefitOption: 'A (Level)',
  })).toBe(true)
  expect(solvedLedgerMatches(snapshot, {
    faceSolve: 'Based on Target Premium', premiumSolve: 'None', faceAmount: 2_000_000,
    monthlyPremium: 100, annualPremium: 18_000, premiumMode: 'Monthly',
    deathBenefitOption: 'A (Level)',
  })).toBe(false)
})

it('matches the National Life Max Cash Value and Retirement Focus strategies', () => {
  const premiumStrategy = {
    schemaVersion: 2, illustrationId: 'ill_cash_123', caseId: null,
    carrierCaseName: 'KEEPRONE-TEST-20260902-CASH123',
    insured: { firstName: 'Ana', lastName: 'Teste', dateOfBirth: '1990-01-01', issueState: 'FL' },
    product: { name: 'FlexLife', code: '956' },
    solve: { basis: 'PREMIUM', method: 'Minimum_DB_Max_Cash_Value', amount: 2_000 },
    faceAmount: null, premium: { mode: 'Monthly', amount: 2_000 },
    underwriting: { gender: 'Female', rateClass: 'Standard_NT' }, deathBenefitOption: 'A_Level',
    allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
    riders: ['DeathBenefitProtection', 'ABRTerminalIllness', 'ABRChronicIllness', 'ABRCriticalIllness', 'ABRCriticalInjury', 'ABRAlzheimersDisease'],
    reports: ['NAIC_ILLUSTRATION'],
  } as const satisfies ForesightSolvedIllustrationSnapshotV2
  expect(solvedLedgerMatches(premiumStrategy, {
    faceSolve: 'Minimum DB/Max Cash Value', premiumSolve: 'None', faceAmount: 1_300_000,
    monthlyPremium: 2_000, annualPremium: 24_000, premiumMode: 'Monthly', deathBenefitOption: 'A (Level)',
  })).toBe(true)

  const retirementStrategy = {
    ...premiumStrategy,
    solve: { basis: 'DEATH_BENEFIT', method: 'Retirement_Focus', amount: 1_300_000 },
    faceAmount: 1_300_000,
    premium: { mode: 'Monthly', amount: null },
  } as const satisfies ForesightSolvedIllustrationSnapshotV2
  expect(solvedLedgerMatches(retirementStrategy, {
    faceSolve: 'None', premiumSolve: 'Retirement Focus', faceAmount: 1_300_000,
    monthlyPremium: 1_000, annualPremium: 12_000, premiumMode: 'Monthly', deathBenefitOption: 'A (Level)',
  })).toBe(true)
})
