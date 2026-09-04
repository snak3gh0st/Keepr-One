import { describe, expect, it } from 'vitest'
import { getMonthBounds, buildProductionRanking } from './agent-production'

describe('getMonthBounds', () => {
  it('returns the first instant of the month through the first instant of the next month', () => {
    const { start, end } = getMonthBounds('2026-07')
    expect(start).toEqual(new Date(Date.UTC(2026, 6, 1)))
    expect(end).toEqual(new Date(Date.UTC(2026, 7, 1)))
  })

  it('rolls over correctly across a year boundary', () => {
    const { start, end } = getMonthBounds('2026-12')
    expect(start).toEqual(new Date(Date.UTC(2026, 11, 1)))
    expect(end).toEqual(new Date(Date.UTC(2027, 0, 1)))
  })

  it('pads single-digit months correctly (January)', () => {
    const { start, end } = getMonthBounds('2026-01')
    expect(start).toEqual(new Date(Date.UTC(2026, 0, 1)))
    expect(end).toEqual(new Date(Date.UTC(2026, 1, 1)))
  })
})

describe('buildProductionRanking', () => {
  const agents = [
    { id: 'a1', name: 'Agente Um' },
    { id: 'a2', name: 'Agente Dois' },
    { id: 'a3', name: 'Agente Três (sem produção)' },
  ]

  it('merges policy and commission stats by agentId', () => {
    const policyStats = [
      { agentId: 'a1', count: 3, premiumSum: 150.5 },
      { agentId: 'a2', count: 1, premiumSum: 40 },
    ]
    const commissionStats = [
      { agentId: 'a1', sum: 200 },
      { agentId: 'a2', sum: 500 },
    ]
    const result = buildProductionRanking(agents, policyStats, commissionStats)
    expect(result).toEqual([
      { agentId: 'a2', agentName: 'Agente Dois', policyCount: 1, premiumTotal: 40, commissionTotal: 500 },
      { agentId: 'a1', agentName: 'Agente Um', policyCount: 3, premiumTotal: 150.5, commissionTotal: 200 },
      { agentId: 'a3', agentName: 'Agente Três (sem produção)', policyCount: 0, premiumTotal: 0, commissionTotal: 0 },
    ])
  })

  it('sorts by commissionTotal descending', () => {
    const policyStats: { agentId: string; count: number; premiumSum: number }[] = []
    const commissionStats = [
      { agentId: 'a1', sum: 10 },
      { agentId: 'a2', sum: 999 },
      { agentId: 'a3', sum: 50 },
    ]
    const result = buildProductionRanking(agents, policyStats, commissionStats)
    expect(result.map((r) => r.agentId)).toEqual(['a2', 'a3', 'a1'])
  })

  it('includes agents with zero production in every column', () => {
    const result = buildProductionRanking(agents, [], [])
    expect(result).toEqual([
      { agentId: 'a1', agentName: 'Agente Um', policyCount: 0, premiumTotal: 0, commissionTotal: 0 },
      { agentId: 'a2', agentName: 'Agente Dois', policyCount: 0, premiumTotal: 0, commissionTotal: 0 },
      { agentId: 'a3', agentName: 'Agente Três (sem produção)', policyCount: 0, premiumTotal: 0, commissionTotal: 0 },
    ])
  })

  it('returns an empty array when there are no agents', () => {
    expect(buildProductionRanking([], [], [])).toEqual([])
  })
})

it('uses UTC even on a host west of Greenwich', () => {
  const timezone = process.env.TZ
  process.env.TZ = 'America/New_York'
  try { expect(getMonthBounds('2026-09').start.toISOString()).toBe('2026-09-01T00:00:00.000Z') }
  finally { if (timezone) process.env.TZ = timezone; else delete process.env.TZ }
})
