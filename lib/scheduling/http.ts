import { SchedulingError } from './errors'

export const SCHEDULING_NO_STORE = { 'Cache-Control': 'no-store' }

export function schedulingErrorResponse(error: unknown) {
  if (error instanceof SchedulingError) {
    const status = error.code === 'PAGE_NOT_FOUND'
      ? 404
      : error.code === 'SLOT_UNAVAILABLE' || error.code === 'IDEMPOTENCY_CONFLICT'
        ? 409
        : error.code === 'SCHEDULING_UNAVAILABLE'
          ? 503
          : 400
    return Response.json(
      { error: error.code, message: error.message },
      { status, headers: SCHEDULING_NO_STORE },
    )
  }
  return Response.json(
    { error: 'BOOKING_FAILED', message: 'Não foi possível concluir esta solicitação agora.' },
    { status: 500, headers: SCHEDULING_NO_STORE },
  )
}
