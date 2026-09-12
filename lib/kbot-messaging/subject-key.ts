/// The one shape a client's `kBotContactPreference.subjectKey` takes when it is
/// keyed by client rather than by phone: `client:<id>`.
///
/// Every writer and every reader of a client-keyed preference must agree on
/// this, or a preference written under one shape is invisible to a gate that
/// looks under another. `scheduled-triggers.ts` minted this key inline before
/// it was pulled out here — this is now the only place that does.

export function subjectKeyForClient(clientId: string): string {
  return `client:${clientId}`
}
