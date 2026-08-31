export type SchedulingErrorCode =
  | 'PAGE_NOT_FOUND'
  | 'SCHEDULING_UNAVAILABLE'
  | 'SLOT_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_REQUEST'

export class SchedulingError extends Error {
  constructor(
    public readonly code: SchedulingErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SchedulingError'
  }
}
