export type CrmStageView = {
  id: string
  name: string
  position: number
  systemKey: string | null
  active: boolean
  caseCount: number
}
export type CrmPipelineView = {
  id: string
  agentId: string
  stages: CrmStageView[]
}

export type DueFollowUpView = {
  id: string
  caseId: string
  ownerAgentId: string
  title: string
  scheduledAt: Date
  overdue: boolean
  overdueDays: number
  prospect: { name: string; phone: string | null; email: string | null }
  stage: { id: string; name: string; systemKey: string | null } | null
  lastInteraction: { title: string; createdAt: Date } | null
  href: string
}

export type FollowUpMutationResult = {
  id: string
  caseId: string
  scheduledAt: Date
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
  completedAt: Date | null
  cancelledAt: Date | null
}
