import { CASE_STAGES, type CaseStage } from './case-workflow'

// Cycle time = how long cases sit in each stage. Reconstructed from stage-change
// events: a transition at time T ends the time spent in its `from` stage, whose
// clock started when the case entered it (the previous transition, or case
// creation for the first stage). Pure over the history so it's testable.
export type StageTransition = { from: CaseStage; to: CaseStage; at: Date }
export type CaseHistory = { createdAt: Date; transitions: StageTransition[] } // transitions ascending by `at`
export type StageCycleTime = { stage: CaseStage; avgDays: number; samples: number }

const DAY_MS = 86_400_000

export function buildCycleTimes(cases: CaseHistory[]): StageCycleTime[] {
  const totals = new Map<CaseStage, { ms: number; n: number }>()

  for (const c of cases) {
    let enteredAt = c.createdAt
    for (const t of c.transitions) {
      const dur = t.at.getTime() - enteredAt.getTime()
      if (dur >= 0) {
        const agg = totals.get(t.from) ?? { ms: 0, n: 0 }
        agg.ms += dur
        agg.n += 1
        totals.set(t.from, agg)
      }
      enteredAt = t.at
    }
  }

  return CASE_STAGES.map((stage) => {
    const agg = totals.get(stage)
    return {
      stage,
      avgDays: agg && agg.n ? agg.ms / agg.n / DAY_MS : 0,
      samples: agg?.n ?? 0,
    }
  }).filter((s) => s.samples > 0)
}
