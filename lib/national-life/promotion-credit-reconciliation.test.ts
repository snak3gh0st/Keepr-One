import { describe, expect, it } from 'vitest'
import {
  PromotionReconciliationValidationError,
  classifyNationalLifeReversalEvidence,
  prepareNationalLifePromotionAdjustment,
  prepareNationalLifePromotionReversal,
} from './promotion-credit-reconciliation'

const original = {
  id: 'confirmed-credit-1',
  carrier: 'NATIONAL_LIFE',
  source: 'POLICY_TARGET_PREMIUM',
  externalId: 'NL123',
  policyNumber: 'NL123',
  producerAgentId: 'leaf',
  targetPremium: '6000',
  anticipatedAnnualPremium: '6500',
  qualificationWeight: '1',
}

const attributions = [
  { kind: 'PERSONAL' as const, agentId: 'leaf' },
  { kind: 'AGENCY' as const, agentId: 'leaf', leaderAgentId: 'mid' },
  { kind: 'AGENCY' as const, agentId: 'leaf', leaderAgentId: 'top' },
]

describe('National Life terminal status evidence', () => {
  it.each([
    ['Not Taken after paid', 'NOT_TAKEN'],
    ['Policy Cancelled', 'CANCELLED'],
    ['Premium refunded', 'REFUNDED'],
    ['Commission charge-back', 'CHARGEBACK'],
  ] as const)('classifies %s as %s', (carrierStatus, reason) => {
    expect(classifyNationalLifeReversalEvidence({ carrierStatus, raw: {} })).toMatchObject({
      reason,
      field: 'carrierStatus',
      value: carrierStatus,
    })
  })

  it('uses explicit carrier indicators and dates without treating false as evidence', () => {
    expect(
      classifyNationalLifeReversalEvidence({
        carrierStatus: 'Paid',
        raw: { ChargebackIndicator: false, RefundDate: '08/09/2026' },
      }),
    ).toEqual({ reason: 'REFUNDED', field: 'RefundDate', value: '08/09/2026' })
  })

  it.each(['Pending', 'Declined', 'Incomplete', 'Unpaid'])(
    'does not reverse a confirmed credit for non-terminal status %s',
    (carrierStatus) => {
      expect(classifyNationalLifeReversalEvidence({ carrierStatus, raw: {} })).toBeNull()
    },
  )
})

describe('append-only promotion reversal', () => {
  it('negates the current recognized total, links the original, and freezes the same hierarchy', () => {
    const result = prepareNationalLifePromotionReversal({
      original,
      currentRecognizedPc: '5900',
      attributions,
      recognizedAt: new Date('2026-08-09T00:00:00.000Z'),
      evidence: { reason: 'CANCELLED', field: 'PolicyStatus', value: 'Cancelled' },
      carrierSnapshot: { PolicyStatus: 'Cancelled' },
    })
    if (!result) throw new Error('Expected a reversal event')

    expect(result).toMatchObject({
      carrier: 'NATIONAL_LIFE',
      source: 'POLICY_TARGET_PREMIUM_RECONCILIATION',
      externalId: 'NL123:REVERSED',
      status: 'REVERSED',
      supersedesCreditId: 'confirmed-credit-1',
      producerAgentId: 'leaf',
    })
    expect(result.creditedPc.toString()).toBe('-5900')
    expect(result.targetPremium?.toString()).toBe('6000')
    expect(result.attributions).toEqual([
      { kind: 'PERSONAL', agentId: 'leaf', leaderAgentId: null },
      { kind: 'AGENCY', agentId: 'leaf', leaderAgentId: 'mid' },
      { kind: 'AGENCY', agentId: 'leaf', leaderAgentId: 'top' },
    ])
    expect(result.rawPayload).toMatchObject({
      reconciliation: {
        reason: 'CANCELLED',
        originalCreditId: 'confirmed-credit-1',
        currentRecognizedPc: '5900',
      },
    })
  })

  it('uses one deterministic key across replays and later terminal labels', () => {
    const common = {
      original,
      currentRecognizedPc: '6000',
      attributions,
      recognizedAt: new Date('2026-08-09T00:00:00.000Z'),
    }
    const cancelled = prepareNationalLifePromotionReversal({
      ...common,
      evidence: { reason: 'CANCELLED' as const, field: 'Status', value: 'Cancelled' },
    })
    const chargeback = prepareNationalLifePromotionReversal({
      ...common,
      evidence: { reason: 'CHARGEBACK' as const, field: 'Status', value: 'Chargeback' },
    })
    if (!cancelled || !chargeback) throw new Error('Expected reversal events')

    expect(cancelled.id).toBe(chargeback.id)
    expect(cancelled.externalId).toBe(chargeback.externalId)
  })

  it('is a no-op when a replay finds no recognized balance left to reverse', () => {
    expect(
      prepareNationalLifePromotionReversal({
        original,
        currentRecognizedPc: 0,
        attributions,
        recognizedAt: new Date(),
        evidence: { reason: 'NOT_TAKEN', field: 'Status', value: 'Not Taken' },
      }),
    ).toBeNull()
  })

  it('fails closed on a corrupted negative recognized balance', () => {
    expect(() =>
      prepareNationalLifePromotionReversal({
        original,
        currentRecognizedPc: -1,
        attributions,
        recognizedAt: new Date(),
        evidence: { reason: 'NOT_TAKEN', field: 'Status', value: 'Not Taken' },
      }),
    ).toThrowError(PromotionReconciliationValidationError)
  })

  it('rejects attributions that do not belong to the original producer', () => {
    expect(() =>
      prepareNationalLifePromotionReversal({
        original,
        currentRecognizedPc: 6000,
        attributions: [{ kind: 'PERSONAL', agentId: 'somebody-else' }],
        recognizedAt: new Date(),
        evidence: { reason: 'NOT_TAKEN', field: 'Status', value: 'Not Taken' },
      }),
    ).toThrowError(PromotionReconciliationValidationError)
  })
})

describe('safe carrier-value adjustment', () => {
  it('creates only the signed delta against an explicitly resolved current total', () => {
    const result = prepareNationalLifePromotionAdjustment({
      original,
      supersedesCreditId: original.id,
      currentRecognizedPc: 6000,
      targetPremium: 5900,
      anticipatedAnnualPremium: 6500,
      qualificationWeight: 1,
      attributions,
      recognizedAt: new Date('2026-08-10T00:00:00.000Z'),
    })

    expect(result).toMatchObject({
      status: 'ADJUSTED',
      supersedesCreditId: 'confirmed-credit-1',
      source: 'POLICY_TARGET_PREMIUM_RECONCILIATION',
    })
    expect(result?.creditedPc.toString()).toBe('-100')
    expect(result?.targetPremium?.toString()).toBe('5900')
  })

  it('supports a positive delta when the lesser carrier fact increases', () => {
    const result = prepareNationalLifePromotionAdjustment({
      original,
      supersedesCreditId: 'adjustment-1',
      currentRecognizedPc: 5000,
      targetPremium: 8000,
      anticipatedAnnualPremium: 5500,
      qualificationWeight: 1,
      attributions,
      recognizedAt: new Date('2026-08-10T00:00:00.000Z'),
    })

    expect(result?.creditedPc.toString()).toBe('500')
    expect(result?.supersedesCreditId).toBe('adjustment-1')
  })

  it('returns no event when changed inputs leave recognized PC unchanged', () => {
    expect(
      prepareNationalLifePromotionAdjustment({
        original,
        supersedesCreditId: original.id,
        currentRecognizedPc: 6000,
        targetPremium: 7000,
        anticipatedAnnualPremium: 6000,
        qualificationWeight: 1,
        attributions,
        recognizedAt: new Date(),
      }),
    ).toBeNull()
  })
})
