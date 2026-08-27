import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), executeTerm: vi.fn() }))
vi.mock('../lib/foresight-executor', async () => {
  const actual = await vi.importActual<typeof import('../lib/foresight-executor')>('../lib/foresight-executor')
  return { ...actual, executeForesightIllustration: mocks.execute }
})
vi.mock('../lib/foresight-term-executor', () => ({ executeForesightTermIllustration: mocks.executeTerm }))

type Listener = (value: unknown, sender: unknown, respond: (value: unknown) => void) => boolean | void
let listener: Listener | undefined

const snapshot = {
  schemaVersion: 1,
  illustrationId: 'ill_123',
  caseId: 'case_123',
  carrierCaseName: 'KEEPRONE-20260826-ILL_123',
  insured: { firstName: 'KeeprOne', lastName: 'Test', dateOfBirth: '1990-01-01', issueState: 'FL' },
  product: { name: 'FlexLife', code: '956' },
  solve: { method: 'Specify_Amount', amount: 100_000 },
  faceAmount: 100_000,
  premium: { mode: 'Monthly', amount: 250 },
  underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
  deathBenefitOption: 'A_Level',
  allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
  riders: [
    'DeathBenefitProtection', 'ABRTerminalIllness', 'ABRChronicIllness',
    'ABRCriticalIllness', 'ABRCriticalInjury', 'ABRAlzheimersDisease',
  ],
  reports: ['NAIC_ILLUSTRATION'],
} as const

const premiumSolvedSnapshot = {
  schemaVersion: 2,
  illustrationId: 'ill_premium_123',
  caseId: null,
  carrierCaseName: 'KEEPRONE-20260827-ILLPREMIUM123',
  insured: { firstName: 'KeeprOne', lastName: 'Premium', dateOfBirth: '1990-01-01', issueState: 'FL' },
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

beforeEach(() => {
  vi.resetModules()
  mocks.execute.mockReset()
  mocks.executeTerm.mockReset()
  listener = undefined
  const fakeWindow = {}
  vi.stubGlobal('window', fakeWindow)
  Object.assign(fakeWindow, { top: fakeWindow })
  vi.stubGlobal('location', { pathname: '/NWI/Main/Layout.aspx' })
  vi.stubGlobal('defineContentScript', (config: unknown) => config)
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: (value: Listener) => { listener = value } } },
  })
})

describe('Foresight isolated-world executor', () => {
  it('returns only the correlated non-PII receipt', async () => {
    const receipt = {
      inputHash: 'a'.repeat(64),
      caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName: snapshot.carrierCaseName,
      productCode: '956',
      release: '5.3.65.31',
      reportCode: 'NAIC_ILLUSTRATION',
      documentSha256: 'c'.repeat(64),
      documentBytes: 9,
      saved: true,
    } as const
    const document = { contentType: 'application/pdf', pdfBase64: 'JVBERi0xLjcK' } as const
    mocks.execute.mockResolvedValue({ receipt, document })
    const content = (await import('../entrypoints/foresight.content')).default as unknown as { main(): void }
    content.main()
    const response = await new Promise<unknown>((resolve) => {
      const async = listener?.({
        type: 'EXECUTE_FORESIGHT_ILLUSTRATION',
        token: 't'.repeat(32),
        correlationId: 'c'.repeat(16),
        inputHash: receipt.inputHash,
        snapshot,
      }, {}, resolve)
      expect(async).toBe(true)
    })
    expect(mocks.execute).toHaveBeenCalledWith({ inputHash: receipt.inputHash, snapshot })
    expect(response).toEqual({
      ok: true,
      type: 'FORESIGHT_ILLUSTRATION_SAVED',
      token: 't'.repeat(32),
      correlationId: 'c'.repeat(16),
      receipt,
      document,
    })
  })

  it('routes a sealed Term command to the Term executor', async () => {
    const termSnapshot = {
      schemaVersion: 1,
      illustrationId: 'ill_term_123',
      caseId: null,
      carrierCaseName: 'KEEPRONE-20260827-ILLTERM123',
      product: { carrierName: 'LSW Term', kind: 'TERM' },
      insured: { firstName: 'KeeprOne', lastName: 'Term', dateOfBirth: '1990-01-01', issueState: 'FL' },
      underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
      faceAmount: 250_000,
      premiumMode: 'Monthly',
      termDuration: '20-G',
      reports: ['NAIC_ILLUSTRATION'],
    } as const
    const receipt = {
      inputHash: 'a'.repeat(64), caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName: termSnapshot.carrierCaseName, carrierProduct: 'LSW Term', release: '5.3.65.31',
      reportCode: 'NAIC_ILLUSTRATION', documentSha256: 'c'.repeat(64), documentBytes: 9, saved: true,
    } as const
    const document = { contentType: 'application/pdf', pdfBase64: 'JVBERi0xLjcK' } as const
    mocks.executeTerm.mockResolvedValue({ receipt, document })
    const content = (await import('../entrypoints/foresight.content')).default as unknown as { main(): void }
    content.main()
    const response = await new Promise<unknown>((resolve) => {
      const async = listener?.({
        type: 'EXECUTE_FORESIGHT_ILLUSTRATION', token: 't'.repeat(32), correlationId: 'c'.repeat(16),
        inputHash: receipt.inputHash, snapshot: termSnapshot,
      }, {}, resolve)
      expect(async).toBe(true)
    })
    expect(mocks.executeTerm).toHaveBeenCalledWith({ inputHash: receipt.inputHash, snapshot: termSnapshot })
    expect(response).toEqual(expect.objectContaining({ ok: true, receipt, document }))
  })

  it('routes a sealed solved IUL command without inventing its calculated result', async () => {
    const receipt = {
      inputHash: 'a'.repeat(64), caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName: premiumSolvedSnapshot.carrierCaseName, productCode: '956', solveBasis: 'PREMIUM',
      faceAmount: 250_000, monthlyPremium: 350, annualPremium: 4_200,
      release: '5.3.65.31', reportCode: 'NAIC_ILLUSTRATION',
      documentSha256: 'c'.repeat(64), documentBytes: 9, saved: true,
    } as const
    const document = { contentType: 'application/pdf', pdfBase64: 'JVBERi0xLjcK' } as const
    mocks.execute.mockResolvedValue({ receipt, document })
    const content = (await import('../entrypoints/foresight.content')).default as unknown as { main(): void }
    content.main()
    const response = await new Promise<unknown>((resolve) => {
      listener?.({
        type: 'EXECUTE_FORESIGHT_ILLUSTRATION', token: 't'.repeat(32), correlationId: 'c'.repeat(16),
        inputHash: receipt.inputHash, snapshot: premiumSolvedSnapshot,
      }, {}, resolve)
    })
    expect(mocks.execute).toHaveBeenCalledWith({ inputHash: receipt.inputHash, snapshot: premiumSolvedSnapshot })
    expect(response).toEqual(expect.objectContaining({ ok: true, receipt, document }))
  })
})
