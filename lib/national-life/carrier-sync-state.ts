/// What the top bar says about the carrier, derived from the queue alone.
///
/// Nothing here knows about sessions, identity providers or expiry. The agent's
/// question is "is my account up to date?", and the honest answer comes from
/// counting what is moving and what is stuck — not from inspecting a cookie.
export type CarrierSyncState =
  | { kind: 'IN_SYNC' }
  | { kind: 'WORKING'; count: number }
  | { kind: 'NEEDS_YOU'; count: number }

/// Blocked beats working. It is the only state that asks the agent for
/// anything, and hiding it behind a cheerier count is how a queue goes silent.
export function carrierSyncState(input: {
  working: number
  blocked: number
}): CarrierSyncState {
  if (input.blocked > 0) return { kind: 'NEEDS_YOU', count: input.blocked }
  if (input.working > 0) return { kind: 'WORKING', count: input.working }
  return { kind: 'IN_SYNC' }
}

export function carrierSyncLabel(state: CarrierSyncState): string {
  switch (state.kind) {
    case 'WORKING':
      return `${state.count} a caminho`
    // No count: this is a call to act, and a number in it reads as progress.
    case 'NEEDS_YOU':
      return 'Precisa de você'
    default:
      return 'Em dia'
  }
}
