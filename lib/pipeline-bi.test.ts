import { describe, it, expect } from 'vitest'
import { buildPipelineFunnel, buildAgentPipeline, type PipelineCase } from './pipeline-bi'

const c = (stage: PipelineCase['stage'], cov = 0, budget = 0): PipelineCase => ({
  stage,
  targetCoverage: cov,
  monthlyBudget: budget,
})

describe('buildPipelineFunnel', () => {
  it('counts by stage and separates open from terminal', () => {
    const f = buildPipelineFunnel([
      c('LEAD'),
      c('DISCOVERY'),
      c('PLACED'),
      c('DECLINED'),
      c('WITHDRAWN'),
    ])
    expect(f.total).toBe(5)
    expect(f.open).toBe(2)
    expect(f.placed).toBe(1)
    expect(f.declined).toBe(1)
    expect(f.withdrawn).toBe(1)
    expect(f.byStage.find((s) => s.stage === 'LEAD')?.count).toBe(1)
  })

  it('win rate is placed over decided (placed+declined), ignoring withdrawn', () => {
    const f = buildPipelineFunnel([c('PLACED'), c('PLACED'), c('DECLINED'), c('WITHDRAWN')])
    expect(f.winRate).toBeCloseTo(2 / 3)
  })

  it('win rate is 0 when nothing is decided', () => {
    expect(buildPipelineFunnel([c('LEAD'), c('DISCOVERY')]).winRate).toBe(0)
  })

  it('sums in-flight coverage/budget only for non-terminal cases', () => {
    const f = buildPipelineFunnel([
      c('DISCOVERY', 500_000, 300),
      c('UNDERWRITING', 250_000, 150),
      c('PLACED', 999_999, 999), // terminal — excluded
    ])
    expect(f.inFlightCoverage).toBe(750_000)
    expect(f.inFlightBudget).toBe(450)
  })
})

describe('buildAgentPipeline', () => {
  const ac = (agentId: string, agentName: string, stage: PipelineCase['stage'], cov = 0) => ({
    agentId,
    agentName,
    stage,
    targetCoverage: cov,
    monthlyBudget: null,
  })

  it('groups by agent and ranks by open workload', () => {
    const rows = buildAgentPipeline([
      ac('a1', 'Ana', 'PLACED'),
      ac('a2', 'Bruno', 'LEAD'),
      ac('a2', 'Bruno', 'DISCOVERY'),
    ])
    expect(rows.map((r) => r.agentId)).toEqual(['a2', 'a1']) // Bruno (2 open) before Ana (0 open)
    expect(rows[0]).toMatchObject({ agentName: 'Bruno', open: 2, placed: 0 })
    expect(rows[1]).toMatchObject({ agentName: 'Ana', open: 0, placed: 1, winRate: 1 })
  })

  it('sums in-flight coverage per agent', () => {
    const rows = buildAgentPipeline([ac('a1', 'Ana', 'DISCOVERY', 300_000), ac('a1', 'Ana', 'PLACED', 999)])
    expect(rows[0].inFlightCoverage).toBe(300_000)
  })
})
