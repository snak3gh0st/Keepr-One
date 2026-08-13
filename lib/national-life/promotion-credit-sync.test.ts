import { describe, expect, it, vi } from 'vitest'
import {
  prepareConfirmedNationalLifePromotionCredit,
  syncConfirmedCasePromotionCredits,
  syncConfirmedCasePromotionCreditsSafely,
} from './promotion-credit-sync'
import type { CaseSnapshot } from './case-snapshot-service'

const FETCHED_AT = new Date('2026-08-10T12:00:00.000Z')

function source(overrides: Record<string, unknown> = {}) {
  return {
    surface: 'CASE_SNAPSHOT' as const,
    policyNumber: ' NL 123 ',
    producerAgentId: 'leaf',
    carrierStatus: 'Issued and Paid',
    targetPremium: '$6,000.00',
    anticipatedAnnualPremium: '6,500.00',
    fetchedAt: FETCHED_AT,
    raw: { PaidDate: '07/15/2026' },
    ...overrides,
  }
}

const ATTRIBUTIONS = [
  { kind: 'PERSONAL' as const, agentId: 'leaf' },
  { kind: 'AGENCY' as const, agentId: 'leaf', leaderAgentId: 'mid' },
  { kind: 'AGENCY' as const, agentId: 'leaf', leaderAgentId: 'top' },
]

describe('confirmed National Life promotion candidate', () => {
  it('uses min(CTP, AAP) at the official first-year target weight', () => {
    const result = prepareConfirmedNationalLifePromotionCredit(source(), ATTRIBUTIONS)

    expect(result.skipped).toBeNull()
    if (!result.candidate) throw new Error('Expected an eligible promotion credit')
    expect(result.candidate.creditedPc.toString()).toBe('6000')
    expect(result.candidate.targetPremium.toString()).toBe('6000')
    expect(result.candidate.anticipatedAnnualPremium.toString()).toBe('6500')
    expect(result.candidate.qualificationWeight.toString()).toBe('1')
    expect(result.candidate.recognizedAt.toISOString()).toBe('2026-07-15T00:00:00.000Z')
    expect(result.candidate.attributions).toHaveLength(3)
  })

  it('caps target premium at AAP and never consults modal premium or commission', () => {
    const result = prepareConfirmedNationalLifePromotionCredit(
      source({
        targetPremium: '8,000',
        anticipatedAnnualPremium: '5,000',
        raw: {
          PaidDate: '07/15/2026',
          ModalPremium: '999,999',
          Commission: '999,999',
        },
      }),
      ATTRIBUTIONS,
    )

    expect(result.candidate?.creditedPc.toString()).toBe('5000')
  })

  it('fails closed for Active/In Force without explicit carrier-paid evidence', () => {
    expect(
      prepareConfirmedNationalLifePromotionCredit(
        source({ carrierStatus: 'Active / In Force', raw: { PolicyIssueDate: '07/01/2026' } }),
        ATTRIBUTIONS,
      ),
    ).toEqual({ candidate: null, skipped: 'NOT_CARRIER_PAID' })
  })

  it('never substitutes PolicyIssueDate for the carrier paid/credit date', () => {
    expect(
      prepareConfirmedNationalLifePromotionCredit(
        source({ raw: { PolicyIssueDate: '07/01/2026' } }),
        ATTRIBUTIONS,
      ),
    ).toEqual({ candidate: null, skipped: 'MISSING_RECOGNITION_DATE' })
  })

  it('accepts an explicit carrier PaidDate even when the grid omits a paid status', () => {
    const result = prepareConfirmedNationalLifePromotionCredit(
      source({ carrierStatus: 'Closed', raw: { PaidDate: '07/15/2026' } }),
      ATTRIBUTIONS,
    )

    expect(result.candidate?.status).toBe('CONFIRMED')
  })

  it('rejects Not Taken even when the status string also contains paid', () => {
    expect(
      prepareConfirmedNationalLifePromotionCredit(
        source({ carrierStatus: 'Paid - Not Taken' }),
        ATTRIBUTIONS,
      ),
    ).toEqual({ candidate: null, skipped: 'NOT_CARRIER_PAID' })
  })

  it('does not create confirmed PC without both CTP and AAP', () => {
    expect(
      prepareConfirmedNationalLifePromotionCredit(
        source({ targetPremium: null, raw: { PaidDate: '07/15/2026', Commission: 9000 } }),
        ATTRIBUTIONS,
      ),
    ).toEqual({ candidate: null, skipped: 'MISSING_TARGET_PREMIUM' })
    expect(
      prepareConfirmedNationalLifePromotionCredit(
        source({ anticipatedAnnualPremium: null }),
        ATTRIBUTIONS,
      ),
    ).toEqual({ candidate: null, skipped: 'MISSING_AAP' })
  })

  it('requires a carrier date and rejects malformed carrier dates', () => {
    expect(
      prepareConfirmedNationalLifePromotionCredit(
        source({ raw: {} }),
        ATTRIBUTIONS,
      ),
    ).toEqual({ candidate: null, skipped: 'MISSING_RECOGNITION_DATE' })
    expect(
      prepareConfirmedNationalLifePromotionCredit(
        source({ raw: { PaidDate: '02/30/2026' } }),
        ATTRIBUTIONS,
      ),
    ).toEqual({ candidate: null, skipped: 'INVALID_RECOGNITION_DATE' })
  })

  it('derives the same event identity across replay surfaces', () => {
    const fromCase = prepareConfirmedNationalLifePromotionCredit(source(), ATTRIBUTIONS)
    const fromInforce = prepareConfirmedNationalLifePromotionCredit(
      source({ surface: 'INFORCE_POLICY', policyNumber: 'nl123' }),
      ATTRIBUTIONS,
    )

    expect(fromCase.candidate?.id).toBe(fromInforce.candidate?.id)
    expect(fromCase.candidate?.externalId).toBe('NL123')
  })
})

describe('promotion ledger sync', () => {
  it('is idempotent, freezes every upline, and records earned ranks once', async () => {
    type StoredCredit = Record<string, unknown> & {
      id: string
      carrier: string
      source: string
      externalId: string
      producerAgentId: string
    }
    const credits = new Map<string, StoredCredit>()
    const attributions = new Map<string, Record<string, unknown>>()
    const achievements = new Map<string, Record<string, unknown>>()

    const tx = {
      agent: {
        findUnique: async ({ where }: { where: { id: string } }) => ({
          promotionAccessScope: where.id === 'leaf' ? 'PERSONAL' : 'AGENCY',
        }),
      },
      promotionCredit: {
        findMany: async (args: { select: Record<string, unknown> }) => {
          if ('attributions' in args.select) {
            return [...credits.values()].map((credit) => ({
              producerAgentId: credit.producerAgentId,
              attributions: [...attributions.values()]
                .filter((row) => row.promotionCreditId === credit.id)
                .map((row) => ({ agentId: row.agentId, leaderAgentId: row.leaderAgentId })),
            }))
          }
          return [...credits.values()]
        },
        createMany: async ({ data }: { data: StoredCredit[] }) => {
          let count = 0
          for (const credit of data) {
            const key = `${credit.carrier}|${credit.source}|${credit.externalId}`
            if (credits.has(key)) continue
            credits.set(key, { ...credit, createdAt: FETCHED_AT })
            count += 1
          }
          return { count }
        },
      },
      promotionCreditAttribution: {
        createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
          for (const row of data) attributions.set(String(row.id), row)
          return { count: data.length }
        },
        findMany: async (args: {
          where: { OR: Array<{ agentId?: string; leaderAgentId?: string }> }
        }) => {
          const personalAgentId = args.where.OR[0]?.agentId
          const agencyLeaderId = args.where.OR[1]?.leaderAgentId
          if (personalAgentId === 'top') {
            const credit = (id: string, producerAgentId: string, creditedPc: string) => ({
              id,
              producerAgentId,
              creditedPc,
              status: 'CONFIRMED',
              recognizedAt: FETCHED_AT,
              createdAt: FETCHED_AT,
            })
            return [
              {
                kind: 'PERSONAL',
                agentId: 'top',
                leaderAgentId: null,
                promotionCredit: credit('top-personal', 'top', '25000'),
              },
              {
                kind: 'AGENCY',
                agentId: 'leaf',
                leaderAgentId: 'top',
                promotionCredit: credit('top-team', 'leaf', '215000'),
              },
            ]
          }
          return [...attributions.values()]
            .filter(
              (row) =>
                (row.kind === 'PERSONAL' && row.agentId === personalAgentId) ||
                (row.kind === 'AGENCY' && row.leaderAgentId === agencyLeaderId),
            )
            .map((row) => {
              const credit = [...credits.values()].find(
                (item) => item.id === row.promotionCreditId,
              ) as StoredCredit
              return {
                kind: row.kind,
                agentId: row.agentId,
                leaderAgentId: row.leaderAgentId,
                promotionCredit: {
                  id: credit.id,
                  producerAgentId: credit.producerAgentId,
                  creditedPc: credit.creditedPc,
                  status: credit.status,
                  recognizedAt: credit.recognizedAt,
                  createdAt: credit.createdAt,
                },
              }
            })
        },
      },
      promotionAchievement: {
        createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
          let count = 0
          for (const row of data) {
            const key = `${row.agentId}|${row.rankId}`
            if (achievements.has(key)) continue
            achievements.set(key, row)
            count += 1
          }
          return { count }
        },
      },
    }
    const database = {
      agent: {
        findMany: async () => [
          { id: 'top', parentAgentId: null },
          { id: 'mid', parentAgentId: 'top' },
          { id: 'leaf', parentAgentId: 'mid' },
        ],
      },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    }
    const snapshot: CaseSnapshot = {
      policyNo: 'NL123',
      insuredName: null,
      ownerName: null,
      product: 'FlexLife II',
      carrierStatus: 'Paid',
      deliveryStatus: null,
      actionRequired: null,
      requirements: null,
      submitDate: null,
      sentDate: null,
      modalPremium: '999999',
      anticipatedAnnualPremium: '6500',
      targetPremium: '6000',
      submitMethod: null,
      caseManager: null,
      agency: null,
      writingAgentName: null,
      writingAgentNumber: null,
      companyCode: 'NLIC',
      raw: { PolicyNo: 'NL123', PaidDate: '07/15/2026', Commission: 999999 },
    }
    const input = {
      agentId: 'leaf',
      deploymentScope: 'test',
      gridKey: 'RECENTLY_CLOSED' as const,
      snapshots: [snapshot],
      fetchedAt: FETCHED_AT,
    }

    const first = await syncConfirmedCasePromotionCredits(input, database as never)
    const replay = await syncConfirmedCasePromotionCredits(input, database as never)
    const changed = await syncConfirmedCasePromotionCredits(
      {
        ...input,
        snapshots: [
          { ...snapshot, targetPremium: '5900', raw: { ...snapshot.raw, TargetPremium: '5900' } },
        ],
      },
      database as never,
    )

    expect(first).toMatchObject({ examined: 1, eligible: 1, inserted: 1 })
    expect(replay).toMatchObject({ examined: 1, eligible: 1, inserted: 0 })
    expect(changed).toMatchObject({
      examined: 1,
      eligible: 1,
      inserted: 0,
      skipped: { CARRIER_VALUE_CHANGED_REQUIRES_ADJUSTMENT: 1 },
    })
    expect(credits).toHaveLength(1)
    expect(attributions).toHaveLength(3)
    expect([...attributions.values()].map((row) => row.leaderAgentId)).toEqual([
      null,
      'mid',
      'top',
    ])
    expect([...achievements.keys()]).toEqual(
      expect.arrayContaining([
        'leaf|district-leader',
        'top|district-leader',
        'top|division-leader',
        'top|regional-leader',
        'top|regional-vice-president',
      ]),
    )
    // With 25k personal / 240k agency, Red qualifies directly while Blue does
    // not meet its 30k personal minimum and is merely inherited in the UI.
    expect(achievements.has('top|agency-vice-president')).toBe(false)
  })

  it('never attaches the losing producer hierarchy after a concurrent identity conflict', async () => {
    const prepared = prepareConfirmedNationalLifePromotionCredit(source(), ATTRIBUTIONS)
    if (!prepared.candidate) throw new Error('Expected an eligible promotion credit')
    const candidate = prepared.candidate
    const attributionCreate = vi.fn()
    let identityReads = 0
    const tx = {
      promotionCredit: {
        findMany: vi.fn(async (args: { select: Record<string, unknown> }) => {
          if ('attributions' in args.select) return []
          identityReads += 1
          if (identityReads === 1) return []
          return [
            {
              id: candidate.id,
              carrier: candidate.carrier,
              source: candidate.source,
              externalId: candidate.externalId,
              policyNumber: candidate.policyNumber,
              producerAgentId: 'concurrent-rival',
              targetPremium: candidate.targetPremium,
              anticipatedAnnualPremium: candidate.anticipatedAnnualPremium,
              qualificationWeight: candidate.qualificationWeight,
              creditedPc: candidate.creditedPc,
              status: candidate.status,
              recognizedAt: candidate.recognizedAt,
            },
          ]
        }),
        // The composite key was won after the initial read but before our insert.
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      promotionCreditAttribution: { createMany: attributionCreate },
    }
    const database = {
      agent: { findMany: vi.fn(async () => [{ id: 'leaf', parentAgentId: null }]) },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    }
    const snapshot: CaseSnapshot = {
      policyNo: 'NL123',
      insuredName: null,
      ownerName: null,
      product: 'FlexLife II',
      carrierStatus: 'Paid',
      deliveryStatus: null,
      actionRequired: null,
      requirements: null,
      submitDate: null,
      sentDate: null,
      modalPremium: null,
      anticipatedAnnualPremium: '6500',
      targetPremium: '6000',
      submitMethod: null,
      caseManager: null,
      agency: null,
      writingAgentName: null,
      writingAgentNumber: null,
      companyCode: 'NLIC',
      raw: { PaidDate: '07/15/2026' },
    }

    const result = await syncConfirmedCasePromotionCredits(
      {
        agentId: 'leaf',
        deploymentScope: 'test',
        gridKey: 'RECENTLY_CLOSED',
        snapshots: [snapshot],
        fetchedAt: FETCHED_AT,
      },
      database as never,
    )

    expect(result).toMatchObject({
      status: 'NEEDS_REVIEW',
      inserted: 0,
      skipped: { CARRIER_VALUE_CHANGED_REQUIRES_ADJUSTMENT: 1 },
    })
    expect(attributionCreate).not.toHaveBeenCalled()
  })

  it('appends a terminal reversal and keeps its date paired with the original credit', async () => {
    const originalRecognizedAt = new Date('2025-01-15T00:00:00.000Z')
    const original = {
      id: 'confirmed-credit',
      carrier: 'NATIONAL_LIFE',
      source: 'POLICY_TARGET_PREMIUM',
      externalId: 'NL123',
      policyNumber: 'NL123',
      producerAgentId: 'leaf',
      targetPremium: '6000',
      anticipatedAnnualPremium: '6500',
      qualificationWeight: '1',
      creditedPc: '6000',
      status: 'CONFIRMED',
      recognizedAt: originalRecognizedAt,
      supersedesCreditId: null,
      createdAt: new Date('2025-01-16T00:00:00.000Z'),
      attributions: ATTRIBUTIONS.map((row) => ({
        ...row,
        leaderAgentId: 'leaderAgentId' in row ? row.leaderAgentId : null,
      })),
    }
    const insertedCredits: Record<string, unknown>[] = []
    const attributionCreate = vi.fn(async () => ({ count: ATTRIBUTIONS.length }))
    const promotionCreditFindMany = vi.fn(
      async (args: { select: Record<string, unknown>; where: Record<string, unknown> }) => {
        if ('attributions' in args.select && 'carrier' in args.select) return [original]
        if ('attributions' in args.select) return []
        if ('source' in args.where && insertedCredits[0]) return [insertedCredits[0]]
        return []
      },
    )
    const tx = {
      promotionCredit: {
        findMany: promotionCreditFindMany,
        createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
          insertedCredits.push({ ...data[0] })
          return { count: 1 }
        }),
      },
      promotionCreditAttribution: { createMany: attributionCreate },
    }
    const database = {
      agent: { findMany: vi.fn(async () => [{ id: 'leaf', parentAgentId: null }]) },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    }
    const snapshot: CaseSnapshot = {
      policyNo: 'NL123',
      insuredName: null,
      ownerName: null,
      product: 'FlexLife II',
      carrierStatus: 'Policy Cancelled',
      deliveryStatus: null,
      actionRequired: null,
      requirements: null,
      submitDate: null,
      sentDate: null,
      modalPremium: null,
      anticipatedAnnualPremium: '6500',
      targetPremium: '6000',
      submitMethod: null,
      caseManager: null,
      agency: null,
      writingAgentName: null,
      writingAgentNumber: null,
      companyCode: 'NLIC',
      raw: { PolicyStatus: 'Cancelled' },
    }

    const result = await syncConfirmedCasePromotionCredits(
      {
        agentId: 'leaf',
        deploymentScope: 'test',
        gridKey: 'RECENTLY_CLOSED',
        snapshots: [snapshot],
        fetchedAt: FETCHED_AT,
      },
      database as never,
    )

    expect(result).toMatchObject({ status: 'SYNCED', eligible: 1, inserted: 1 })
    expect(insertedCredits[0]).toMatchObject({
      source: 'POLICY_TARGET_PREMIUM_RECONCILIATION',
      externalId: 'NL123:REVERSED',
      status: 'REVERSED',
      supersedesCreditId: 'confirmed-credit',
      creditedPc: expect.objectContaining({}),
      recognizedAt: originalRecognizedAt,
    })
    expect(String(insertedCredits[0].creditedPc)).toBe('-6000')
    expect(attributionCreate).toHaveBeenCalledOnce()
  })

  it('treats a terminal replay with zero remaining policy balance as SYNCED', async () => {
    const recognizedAt = new Date('2025-01-15T00:00:00.000Z')
    const original = {
      id: 'confirmed-credit',
      carrier: 'NATIONAL_LIFE',
      source: 'POLICY_TARGET_PREMIUM',
      externalId: 'NL123',
      policyNumber: 'NL123',
      producerAgentId: 'leaf',
      targetPremium: '6000',
      anticipatedAnnualPremium: '6500',
      qualificationWeight: '1',
      creditedPc: '6000',
      status: 'CONFIRMED',
      recognizedAt,
      supersedesCreditId: null,
      createdAt: new Date('2025-01-16T00:00:00.000Z'),
      attributions: ATTRIBUTIONS,
    }
    const reversal = {
      ...original,
      id: 'reversal-credit',
      source: 'POLICY_TARGET_PREMIUM_RECONCILIATION',
      externalId: 'NL123:REVERSED',
      creditedPc: '-6000',
      status: 'REVERSED',
      supersedesCreditId: original.id,
      createdAt: new Date('2025-01-17T00:00:00.000Z'),
      attributions: ATTRIBUTIONS,
    }
    const tx = {
      promotionCredit: { findMany: vi.fn(async () => [original, reversal]) },
    }
    const database = {
      agent: { findMany: vi.fn(async () => [{ id: 'leaf', parentAgentId: null }]) },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    }
    const snapshot = {
      policyNo: 'NL123',
      insuredName: null,
      ownerName: null,
      product: 'FlexLife II',
      carrierStatus: 'Not Taken',
      deliveryStatus: null,
      actionRequired: null,
      requirements: null,
      submitDate: null,
      sentDate: null,
      modalPremium: null,
      anticipatedAnnualPremium: '6500',
      targetPremium: '6000',
      submitMethod: null,
      caseManager: null,
      agency: null,
      writingAgentName: null,
      writingAgentNumber: null,
      companyCode: 'NLIC',
      raw: { PolicyStatus: 'Not Taken' },
    } satisfies CaseSnapshot

    const result = await syncConfirmedCasePromotionCredits(
      {
        agentId: 'leaf',
        deploymentScope: 'test',
        gridKey: 'RECENTLY_CLOSED',
        snapshots: [snapshot],
        fetchedAt: FETCHED_AT,
      },
      database as never,
    )

    expect(result).toEqual({
      status: 'SYNCED',
      examined: 1,
      eligible: 0,
      inserted: 0,
      skipped: {},
    })
  })

  it('returns NEEDS_REVIEW instead of surfacing a promotion-writer failure', async () => {
    const snapshot = {
      policyNo: 'NL123',
      insuredName: null,
      ownerName: null,
      product: 'FlexLife II',
      carrierStatus: 'Paid',
      deliveryStatus: null,
      actionRequired: null,
      requirements: null,
      submitDate: null,
      sentDate: null,
      modalPremium: null,
      targetPremium: '6000',
      anticipatedAnnualPremium: '6500',
      submitMethod: null,
      caseManager: null,
      agency: null,
      writingAgentName: null,
      writingAgentNumber: null,
      companyCode: 'NLIC',
      raw: { PaidDate: '07/15/2026' },
    } satisfies CaseSnapshot
    const database = {
      agent: { findMany: vi.fn(async () => Promise.reject(new Error('ledger unavailable'))) },
      $transaction: vi.fn(),
    }

    await expect(
      syncConfirmedCasePromotionCreditsSafely(
        {
          agentId: 'leaf',
          deploymentScope: 'test',
          gridKey: 'RECENTLY_CLOSED',
          snapshots: [snapshot],
          fetchedAt: FETCHED_AT,
        },
        database as never,
      ),
    ).resolves.toEqual({
      status: 'NEEDS_REVIEW',
      examined: 1,
      eligible: 0,
      inserted: 0,
      skipped: { PROMOTION_WRITER_FAILED: 1 },
    })
  })
})
