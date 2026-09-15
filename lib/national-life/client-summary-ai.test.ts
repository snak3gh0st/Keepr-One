import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
vi.mock('openai', () => ({ default: class { responses = { create } } }))
const { interpretClientSummary } = await import('./client-summary-ai')

const summary = {
  kind: 'PROJECTED' as const, insuredName: 'Client', productLabel: 'FlexLife',
  faceAmount: 500_000, monthlyPremium: 100, annualPremium: 1_200,
  issuedOn: new Date('2026-09-01'), advisorName: null,
  coverage: [1, 2, 3].map((year) => ({ policyYear: year, age: 39 + year,
    premiumOutlay: 1_200, accumulatedValue: year * 1_000,
    cashSurrenderValue: year === 3 ? 3_800 : year * 500,
    netDeathBenefit: 500_000 + year * 1_000 })),
  milestones: [], fullMilestones: [], outlook: null, lapseYear: null, mecYear: null,
  guaranteed: [], guaranteedLapse: null, scenarios: null,
}

describe('illustration interpretation', () => {
  beforeEach(() => { create.mockReset(); process.env.OPENAI_API_KEY = 'test' })

  it('accepts only highlighted years that exist in the carrier ledger', async () => {
    create.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({
      focus: 'CASH_VALUE', highlightYears: [1, 3, 99],
    }) })
    await expect(interpretClientSummary(summary)).resolves.toEqual({
      focus: 'CASH_VALUE', highlightYears: [1, 3], source: 'AI',
    })
    const request = create.mock.calls[0]?.[0]
    expect(request.store).toBe(false)
    expect(request.input).not.toContain(summary.insuredName)
    expect(JSON.parse(request.input)).toEqual(expect.objectContaining({
      availableYears: [1, 2, 3],
      points: summary.coverage.map((point) => ({
        year: point.policyYear,
        age: point.age,
        deathBenefit: point.netDeathBenefit,
        cashSurrenderValue: point.cashSurrenderValue,
      })),
    }))
  })

  it('falls back safely when the model output cannot be used', async () => {
    create.mockRejectedValue(new Error('offline'))
    const result = await interpretClientSummary(summary)
    expect(result.source).toBe('RULES')
    expect(result.highlightYears).toEqual([1, 3])
  })
})
