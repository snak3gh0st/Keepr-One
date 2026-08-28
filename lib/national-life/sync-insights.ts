import { parseCarrierAmount } from './commission-records'

export type NationalLifeSyncEstimate = {
  lowerMinutes: number
  upperMinutes: number
  basisRuns: number
}

export type NationalLifeSyncDelta = {
  addedRecords: number
  refreshedRecords: number
  newCommissionAmount: number | null
}

export type StageTimingHistory = {
  startedAt: Date
  completions: ReadonlyArray<{ gridKey: string; completedAt: Date }>
}

export function estimateSyncWindow(input: {
  plannedGridKeys: readonly string[]
  completedGridKeys: readonly string[]
  history: readonly StageTimingHistory[]
}): NationalLifeSyncEstimate | null {
  const completed = new Set(input.completedGridKeys)
  const remaining = input.plannedGridKeys.filter((gridKey) => !completed.has(gridKey))
  if (remaining.length === 0) return null

  const observedMinutes = input.history.flatMap((run) => {
    const completionByGrid = new Map(run.completions.map((row) => [row.gridKey, row.completedAt]))
    let previous = run.startedAt
    let remainingMinutes = 0
    for (const gridKey of input.plannedGridKeys) {
      const completion = completionByGrid.get(gridKey)
      if (!completion) return []
      const minutes = (completion.getTime() - previous.getTime()) / 60_000
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) return []
      if (!completed.has(gridKey)) remainingMinutes += minutes
      previous = completion
    }
    return remainingMinutes > 0 ? [remainingMinutes] : []
  })

  if (observedMinutes.length === 0) return null
  const lowest = Math.min(...observedMinutes)
  const highest = Math.max(...observedMinutes)
  const lowerMinutes = Math.max(1, Math.floor(
    observedMinutes.length === 1 ? lowest * 0.8 : lowest,
  ))
  const upperMinutes = Math.max(lowerMinutes, Math.ceil(
    observedMinutes.length === 1 ? highest * 1.25 : highest,
  ))
  return { lowerMinutes, upperMinutes, basisRuns: observedMinutes.length }
}

export function summarizeSyncDelta(input: {
  addedBySource: Readonly<Record<string, number>>
  refreshedBySource: Readonly<Record<string, number>>
  newCommissionAmounts: readonly unknown[]
}): NationalLifeSyncDelta {
  const add = (values: Readonly<Record<string, number>>) =>
    Object.values(values).reduce((total, value) => total + Math.max(0, value), 0)
  const amounts = input.newCommissionAmounts
    .map(parseCarrierAmount)
    .filter((value): value is number => value !== null)
  return {
    addedRecords: add(input.addedBySource),
    refreshedRecords: add(input.refreshedBySource),
    newCommissionAmount: amounts.length > 0
      ? amounts.reduce((total, value) => total + value, 0)
      : null,
  }
}
