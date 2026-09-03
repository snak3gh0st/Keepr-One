import { describe, expect, it } from 'vitest'
import {
  FORESIGHT_APPROVED_RELEASES,
  canonicalForesightSnapshot,
  classifyForesightLocation,
  parseForesightIllustrationSnapshot,
  parseForesightRelease,
  sha256ForesightSnapshot,
} from './foresight-contract'

const snapshot = {
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
} as const

const premiumSolvedSnapshot = {
  schemaVersion: 2,
  illustrationId: 'ill_premium_123',
  caseId: 'case_123',
  carrierCaseName: 'KEEPRONE-TEST-20260827-ILLPREMIUM123',
  insured: {
    firstName: 'KeeprOne', lastName: 'Test', dateOfBirth: '1990-01-01', issueState: 'FL',
  },
  product: { name: 'FlexLife', code: '956' },
  solve: { basis: 'PREMIUM', method: 'Based_on_Target_Premium', amount: 350 },
  faceAmount: null,
  premium: { mode: 'Monthly', amount: 350 },
  underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
  deathBenefitOption: 'A_Level',
  allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
  riders: [
    'DeathBenefitProtection', 'ABRTerminalIllness', 'ABRChronicIllness',
    'ABRCriticalIllness', 'ABRCriticalInjury', 'ABRAlzheimersDisease',
  ],
  reports: ['NAIC_ILLUSTRATION'],
} as const

describe('Foresight illustration execution snapshot', () => {
  it('accepts the exact bounded v1 shape', () => {
    expect(parseForesightIllustrationSnapshot(snapshot)).toEqual(snapshot)
    expect(parseForesightIllustrationSnapshot({ ...snapshot, caseId: null })).toMatchObject({
      caseId: null,
    })
  })

  it('accepts a premium-solved v2 snapshot only when the unknown face amount is null', () => {
    expect(parseForesightIllustrationSnapshot(premiumSolvedSnapshot)).toEqual(premiumSolvedSnapshot)
    expect(parseForesightIllustrationSnapshot({ ...premiumSolvedSnapshot, faceAmount: 250_000 })).toBeNull()
    expect(parseForesightIllustrationSnapshot({
      ...premiumSolvedSnapshot,
      solve: { ...premiumSolvedSnapshot.solve, method: 'Protection_Focus' },
    })).toBeNull()
  })

  it('accepts the strategic solve methods only with their matching source amount', () => {
    expect(parseForesightIllustrationSnapshot({
      ...premiumSolvedSnapshot,
      solve: { ...premiumSolvedSnapshot.solve, method: 'Minimum_DB_Max_Cash_Value' },
    })).toMatchObject({ solve: { method: 'Minimum_DB_Max_Cash_Value' } })
    expect(parseForesightIllustrationSnapshot({
      ...premiumSolvedSnapshot,
      solve: { ...premiumSolvedSnapshot.solve, method: 'Retirement_Focus' },
    })).toBeNull()
  })

  it.each([
    { ...snapshot, schemaVersion: 2 },
    { ...snapshot, carrierCaseName: '../wrong' },
    { ...snapshot, insured: { ...snapshot.insured, dateOfBirth: '01/01/1990' } },
    { ...snapshot, insured: { ...snapshot.insured, issueState: 'New York' } },
    { ...snapshot, solve: { ...snapshot.solve, amount: 0 } },
    { ...snapshot, premium: { ...snapshot.premium, amount: 0 } },
    { ...snapshot, allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 99 }] },
    { ...snapshot, allocations: [{ strategy: 'FixedTermStrategy', percentage: 100 }] },
    { ...snapshot, riders: [] },
    { ...snapshot, reports: ['OTHER_REPORT'] },
    { ...snapshot, unexpected: true },
  ])('rejects malformed or open-ended snapshots', (candidate) => {
    expect(parseForesightIllustrationSnapshot(candidate)).toBeNull()
  })

  it('canonicalizes keys and hashes the reviewed snapshot deterministically', async () => {
    const reordered = {
      reports: snapshot.reports,
      riders: snapshot.riders,
      allocations: snapshot.allocations,
      deathBenefitOption: snapshot.deathBenefitOption,
      underwriting: snapshot.underwriting,
      premium: snapshot.premium,
      faceAmount: snapshot.faceAmount,
      solve: snapshot.solve,
      product: snapshot.product,
      insured: snapshot.insured,
      carrierCaseName: snapshot.carrierCaseName,
      caseId: snapshot.caseId,
      illustrationId: snapshot.illustrationId,
      schemaVersion: snapshot.schemaVersion,
    }
    expect(canonicalForesightSnapshot(reordered)).toBe(canonicalForesightSnapshot(snapshot))
    await expect(sha256ForesightSnapshot(snapshot)).resolves.toMatch(/^[a-f0-9]{64}$/)
    await expect(sha256ForesightSnapshot(reordered)).resolves.toBe(
      await sha256ForesightSnapshot(snapshot),
    )
  })
})

describe('Foresight landing and release boundary', () => {
  it('accepts only the same-origin NWI authenticated surface', () => {
    expect(classifyForesightLocation('https://www.nationallife.com/NWI/Main/Layout.aspx'))
      .toBe('FORESIGHT')
    expect(classifyForesightLocation('https://www.nationallife.com/NWI/Main/StartPage.aspx'))
      .toBe('FORESIGHT')
  })

  it.each([
    ['https://nlg-prod.auth0.com/login', 'AUTH_REQUIRED'],
    ['https://nlg-prod.auth0.com/mfa', 'MFA_REQUIRED'],
    ['https://www.nationallife.com/NWI/Unsecure/ShowMessage.aspx', 'AUTH_REQUIRED'],
    ['https://www.nationallife.com/agent/auth/login', 'AUTH_REQUIRED'],
    ['https://evil.example/NWI/Main/Layout.aspx', 'UNEXPECTED_ORIGIN'],
    ['https://www.nationallife.com/agent/', 'UNEXPECTED_PATH'],
  ] as const)('classifies %s without treating it as Foresight', (url, expected) => {
    expect(classifyForesightLocation(url)).toBe(expected)
  })

  it('recognizes only releases observed and approved by the connector', () => {
    expect(FORESIGHT_APPROVED_RELEASES).toContain('26.0.1')
    expect(parseForesightRelease({
      visibleText: 'NLGroup Illustrations - Foresight Web Release v26.0.1',
      scriptUrls: [],
    })).toBe('26.0.1')
    expect(parseForesightRelease({
      visibleText: '',
      scriptUrls: ['https://www.nationallife.com/NWI/Scripts/ForeSight.Release-5.3.65.31.js'],
    })).toBe('5.3.65.31')
    expect(parseForesightRelease({ visibleText: 'Release v99.9.9', scriptUrls: [] })).toBeNull()
  })
})
