import type { CarrierSyncState } from '@/lib/national-life/carrier-sync-state'

export type CarrierActivitySnapshot = {
  state?: CarrierSyncState | null
  connector?: { enabled: boolean; extensionTarget?: string | null; autoLoginEnabled?: boolean } | null
  sync?: { runId?: string; state?: string; completed: number; total: number; shouldPoll: boolean; startedAt?: string | null; completedAt?: string | null; estimate?: { lowerMinutes: number; upperMinutes: number } | null } | null
  illustration?: { id: string; state: 'WORKING' | 'NEEDS_YOU' | 'NEEDS_KBOT' | 'READY' | 'FAILED'; updatedAt: string } | null
  application?: { id: string; caseId: string; state: 'WORKING' | 'NEEDS_YOU' | 'READY' | 'FAILED'; updatedAt: string } | null
  followup?: { working: number; attention: number } | null
}
export type ActivityGroup = 'attention' | 'working' | 'history'
export type CarrierActivity = {
  id: string; kind: 'sync' | 'illustration' | 'application'; status: string; group: ActivityGroup; href: string; at: string | null
  progress?: { completed: number; total: number }
}
export function carrierActivities(snapshot: CarrierActivitySnapshot): CarrierActivity[] {
  const rows: CarrierActivity[] = []
  const sync = snapshot.sync
  if (sync) {
    const status = sync.state ?? (sync.shouldPoll ? 'RUNNING' : 'UNKNOWN')
    const group = ['PAUSED', 'PARTIAL', 'FAILED', 'UNKNOWN'].includes(status) ? 'attention'
      : sync.shouldPoll ? 'working' : 'history'
    rows.push({ id: `sync:${sync.runId ?? 'latest'}`, kind: 'sync', status, group,
      href: '/agent/integrations/national-life', at: sync.completedAt ?? sync.startedAt ?? null,
      progress: { completed: sync.completed, total: sync.total } })
  }
  for (const kind of ['illustration', 'application'] as const) {
    const operation = snapshot[kind]
    if (!operation) continue
    rows.push({ id: `${kind}:${operation.id}`, kind, status: operation.state,
      group: operation.state === 'READY' ? 'history' : operation.state === 'WORKING' ? 'working' : 'attention',
      href: kind === 'illustration' ? `/agent/illustrations/${operation.id}` : `/agent/cases/${snapshot.application!.caseId}`,
      at: operation.updatedAt })
  }
  return rows
}
export function followupActivityGroup(status: string): ActivityGroup {
  if (['UNKNOWN', 'FAILED'].includes(status)) return 'attention'
  if (['PENDING', 'PREPARING', 'DISPATCHING', 'ACCEPTED', 'CANCEL_REQUESTED'].includes(status)) return 'working'
  return 'history'
}
