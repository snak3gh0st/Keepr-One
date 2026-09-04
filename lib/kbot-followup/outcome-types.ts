export type FollowupOutcome = {
  state: 'RESOLVED' | 'PENDING' | 'AWAITING_UPDATE' | 'REVIEW_REQUIRED'
  checkedAt: string | null
  sourceHref: string | null
}
export type FollowupResults = {
  delivered: number
  tracked: number
  resolved: number
  pending: number
  unverified: number
}
