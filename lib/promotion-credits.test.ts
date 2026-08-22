import { describe, expect, it } from 'vitest'
import {
  calculateLifeTargetPc,
  isRecognizedPromotionCreditStatus,
  PromotionCreditValidationError,
  validateFrozenPromotionAttributions,
  validatePromotionCreditEvent,
  type LifeTargetPcInput,
} from './promotion-credits'

function expectValidationCode(run: () => unknown, code: string) {
  try {
    run()
    throw new Error('Expected validation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(PromotionCreditValidationError)
    expect((error as PromotionCreditValidationError).code).toBe(code)
  }
}

describe('calculateLifeTargetPc', () => {
  it('uses CTP when it is lower than AAP', () => {
    const pc = calculateLifeTargetPc({
      targetPremium: '5,000'.replace(',', ''),
      anticipatedAnnualPremium: 6_000,
      qualificationWeight: 1,
    })

    expect(pc.toString()).toBe('5000')
  })

  it('caps CTP at AAP before applying the product weight', () => {
    const pc = calculateLifeTargetPc({
      targetPremium: 8_000,
      anticipatedAnnualPremium: 6_000,
      qualificationWeight: '0.75',
    })

    expect(pc.toString()).toBe('4500')
  })

  it('keeps decimal precision without binary floating-point rounding', () => {
    const pc = calculateLifeTargetPc({
      targetPremium: '1234.56',
      anticipatedAnnualPremium: '1300',
      qualificationWeight: '0.3333',
    })

    expect(pc.toString()).toBe('411.478848')
  })

  it('never uses commission dollars as a fallback or multiplier', () => {
    const input = {
      targetPremium: 5_000,
      anticipatedAnnualPremium: 4_000,
      qualificationWeight: 0.5,
      commissionAmount: 999_999,
    } as LifeTargetPcInput

    expect(calculateLifeTargetPc(input).toString()).toBe('2000')
  })

  it('fails closed when carrier CTP is missing', () => {
    expectValidationCode(
      () =>
        calculateLifeTargetPc({
          targetPremium: null,
          anticipatedAnnualPremium: 5_000,
          qualificationWeight: 1,
        }),
      'MISSING_TARGET_PREMIUM',
    )
  })

  it('fails closed when AAP is missing', () => {
    expectValidationCode(
      () =>
        calculateLifeTargetPc({
          targetPremium: 5_000,
          anticipatedAnnualPremium: undefined,
          qualificationWeight: 1,
        }),
      'MISSING_ANTICIPATED_ANNUAL_PREMIUM',
    )
  })

  it.each([
    [{ targetPremium: -1, anticipatedAnnualPremium: 100, qualificationWeight: 1 }, 'INVALID_TARGET_PREMIUM'],
    [
      { targetPremium: 100, anticipatedAnnualPremium: -1, qualificationWeight: 1 },
      'INVALID_ANTICIPATED_ANNUAL_PREMIUM',
    ],
    [
      { targetPremium: 100, anticipatedAnnualPremium: 100, qualificationWeight: -1 },
      'INVALID_QUALIFICATION_WEIGHT',
    ],
  ] as const)('rejects invalid formula inputs', (input, code) => {
    expectValidationCode(() => calculateLifeTargetPc(input), code)
  })
})

describe('validatePromotionCreditEvent', () => {
  it('accepts a confirmed positive production event', () => {
    expect(
      validatePromotionCreditEvent({ status: 'CONFIRMED', creditedPc: '4250.25' }).toString(),
    ).toBe('4250.25')
  })

  it('accepts a signed adjustment linked to the original event', () => {
    expect(
      validatePromotionCreditEvent({
        status: 'ADJUSTED',
        creditedPc: '-125.5',
        supersedesCreditId: 'credit-1',
      }).toString(),
    ).toBe('-125.5')
  })

  it('requires reversals to be negative and linked', () => {
    expectValidationCode(
      () => validatePromotionCreditEvent({ status: 'REVERSED', creditedPc: -500 }),
      'MISSING_SUPERSEDED_CREDIT',
    )
    expectValidationCode(
      () =>
        validatePromotionCreditEvent({
          status: 'REVERSED',
          creditedPc: 500,
          supersedesCreditId: 'credit-1',
        }),
      'INVALID_CREDIT_DELTA_SIGN',
    )
  })

  it('counts only carrier-recognized deltas toward a promotion total', () => {
    expect(isRecognizedPromotionCreditStatus('ESTIMATED')).toBe(false)
    expect(isRecognizedPromotionCreditStatus('PENDING_CARRIER')).toBe(false)
    expect(isRecognizedPromotionCreditStatus('CONFIRMED')).toBe(true)
    expect(isRecognizedPromotionCreditStatus('ADJUSTED')).toBe(true)
    expect(isRecognizedPromotionCreditStatus('REVERSED')).toBe(true)
  })
})

describe('validateFrozenPromotionAttributions', () => {
  it('freezes one personal view and every unique upline for the same producer', () => {
    expect(
      validateFrozenPromotionAttributions([
        { kind: 'PERSONAL', agentId: ' agent-1 ' },
        { kind: 'AGENCY', agentId: 'agent-1', leaderAgentId: ' leader-1 ' },
        { kind: 'AGENCY', agentId: 'agent-1', leaderAgentId: ' leader-2 ' },
      ]),
    ).toEqual([
      { kind: 'PERSONAL', agentId: 'agent-1', leaderAgentId: null },
      { kind: 'AGENCY', agentId: 'agent-1', leaderAgentId: 'leader-1' },
      { kind: 'AGENCY', agentId: 'agent-1', leaderAgentId: 'leader-2' },
    ])
  })

  it('rejects the same agency leader twice for one credit', () => {
    expectValidationCode(
      () =>
        validateFrozenPromotionAttributions([
          { kind: 'PERSONAL', agentId: 'agent-1' },
          { kind: 'AGENCY', agentId: 'agent-1', leaderAgentId: 'leader-1' },
          { kind: 'AGENCY', agentId: 'agent-1', leaderAgentId: ' leader-1 ' },
        ]),
      'DUPLICATE_ATTRIBUTION',
    )
  })

  it('rejects more than one personal row for a credit', () => {
    expectValidationCode(
      () =>
        validateFrozenPromotionAttributions([
          { kind: 'PERSONAL', agentId: 'agent-1' },
          { kind: 'PERSONAL', agentId: 'agent-1' },
        ]),
      'DUPLICATE_ATTRIBUTION',
    )
  })

  it('requires an agency leader and keeps personal attribution leader-free', () => {
    expectValidationCode(
      () =>
        validateFrozenPromotionAttributions([
          { kind: 'PERSONAL', agentId: 'agent-1' },
          { kind: 'AGENCY', agentId: 'agent-1' },
        ]),
      'INVALID_ATTRIBUTION_LEADER',
    )
    expectValidationCode(
      () =>
        validateFrozenPromotionAttributions([
          { kind: 'PERSONAL', agentId: 'agent-1', leaderAgentId: 'leader-1' },
        ]),
      'INVALID_ATTRIBUTION_LEADER',
    )
    expectValidationCode(
      () =>
        validateFrozenPromotionAttributions([
          { kind: 'PERSONAL', agentId: 'agent-1' },
          { kind: 'AGENCY', agentId: 'agent-1', leaderAgentId: 'agent-1' },
        ]),
      'INVALID_ATTRIBUTION_LEADER',
    )
  })

  it('requires a personal attribution and the same producer in both views', () => {
    expectValidationCode(
      () =>
        validateFrozenPromotionAttributions([
          { kind: 'AGENCY', agentId: 'agent-1', leaderAgentId: 'leader-1' },
        ]),
      'MISSING_PERSONAL_ATTRIBUTION',
    )
    expectValidationCode(
      () =>
        validateFrozenPromotionAttributions([
          { kind: 'PERSONAL', agentId: 'agent-1' },
          { kind: 'AGENCY', agentId: 'agent-2', leaderAgentId: 'leader-1' },
        ]),
      'ATTRIBUTION_AGENT_MISMATCH',
    )
  })
})
