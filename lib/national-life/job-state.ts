export type BrowserJobState =
  | 'QUEUED'
  | 'RUNNING'
  | 'ACTION_REQUIRED'
  | 'WAITING_FOR_MFA'
  | 'WAITING_FOR_REVIEW'
  | 'RETRYABLE'
  | 'CREDENTIALS_EXPIRED'
  | 'MANUAL_REVIEW'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'

const allowedBrowserJobTransitions: Record<BrowserJobState, readonly BrowserJobState[]> = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: [
    'ACTION_REQUIRED',
    'WAITING_FOR_REVIEW',
    'RETRYABLE',
    'MANUAL_REVIEW',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ],
  WAITING_FOR_MFA: ['ACTION_REQUIRED', 'CANCELLED'],
  ACTION_REQUIRED: ['QUEUED', 'CANCELLED'],
  WAITING_FOR_REVIEW: ['QUEUED', 'MANUAL_REVIEW', 'FAILED', 'CANCELLED'],
  RETRYABLE: ['QUEUED', 'MANUAL_REVIEW', 'FAILED', 'CANCELLED'],
  CREDENTIALS_EXPIRED: ['ACTION_REQUIRED', 'CANCELLED'],
  MANUAL_REVIEW: ['QUEUED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
}

export function assertBrowserJobTransition(from: BrowserJobState, to: BrowserJobState): void {
  if (!allowedBrowserJobTransitions[from].includes(to)) {
    throw new Error(`Invalid browser job transition: ${from} -> ${to}`)
  }
}
