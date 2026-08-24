export class CrmDomainError extends Error {
  constructor(
    public readonly code:
      | 'CASE_NOT_FOUND'
      | 'STAGE_NOT_FOUND'
      | 'STAGE_HAS_CASES'
      | 'INVALID_STAGE_ORDER'
      | 'FOLLOW_UP_NOT_FOUND'
      | 'FOLLOW_UP_NOT_SCHEDULED'
      | 'FOLLOW_UP_ALREADY_SCHEDULED'
      | 'ACCESS_DENIED'
      | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message)
    this.name = 'CrmDomainError'
  }
}
