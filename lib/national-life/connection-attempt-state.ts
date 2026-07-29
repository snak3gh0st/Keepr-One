export type NationalLifeConnectionAttemptState =
  | 'OPENING_PORTAL'
  | 'AWAITING_LOGIN'
  | 'AWAITING_MFA'
  | 'AUTHENTICATED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'

const transitions: Record<NationalLifeConnectionAttemptState, readonly NationalLifeConnectionAttemptState[]> = {
  OPENING_PORTAL: ['AWAITING_LOGIN', 'FAILED', 'CANCELLED', 'EXPIRED'],
  AWAITING_LOGIN: ['AWAITING_MFA', 'AUTHENTICATED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  AWAITING_MFA: ['AWAITING_LOGIN', 'AUTHENTICATED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  AUTHENTICATED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
}

export function assertConnectionAttemptTransition(
  from: NationalLifeConnectionAttemptState,
  to: NationalLifeConnectionAttemptState,
) {
  if (!transitions[from].includes(to)) {
    throw new Error(`Invalid National Life connection transition: ${from} -> ${to}`)
  }
}
