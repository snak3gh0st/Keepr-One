import { SchedulingError } from './errors'
import { normalizeLanguage, type UserLanguage } from '@/lib/i18n/config'
import { localize } from '@/lib/i18n/catalog'

export const SCHEDULING_NO_STORE = { 'Cache-Control': 'no-store' }

export function schedulingRequestLanguage(request: Request): UserLanguage {
  const selected = normalizeLanguage(request.headers.get('x-keepr-one-language'))
  if (selected) return selected
  return request.headers.get('accept-language')?.toLowerCase().startsWith('en') ? 'EN' : 'PT'
}

export function schedulingMessage(language: UserLanguage, portuguese: string, english: string) {
  return localize(language, portuguese, english)
}

function publicErrorMessage(code: SchedulingError['code'], language: UserLanguage) {
  switch (code) {
    case 'PAGE_NOT_FOUND':
      return schedulingMessage(language, 'Esta página de agendamento não está disponível.', 'This scheduling page is not available.')
    case 'SCHEDULING_UNAVAILABLE':
      return schedulingMessage(language, 'O agendamento está temporariamente indisponível.', 'Scheduling is temporarily unavailable.')
    case 'SLOT_UNAVAILABLE':
      return schedulingMessage(language, 'Este horário não está mais disponível.', 'This time is no longer available.')
    case 'IDEMPOTENCY_CONFLICT':
      return schedulingMessage(language, 'Os dados desta solicitação foram alterados. Tente novamente.', 'The details of this request changed. Try again.')
    case 'INVALID_REQUEST':
      return schedulingMessage(language, 'Revise os dados da reserva.', 'Review the booking details.')
  }
}

export function schedulingErrorResponse(error: unknown, language: UserLanguage = 'PT') {
  if (error instanceof SchedulingError) {
    const status = error.code === 'PAGE_NOT_FOUND'
      ? 404
      : error.code === 'SLOT_UNAVAILABLE' || error.code === 'IDEMPOTENCY_CONFLICT'
        ? 409
        : error.code === 'SCHEDULING_UNAVAILABLE'
          ? 503
          : 400
    return Response.json(
      { error: error.code, message: publicErrorMessage(error.code, language) },
      { status, headers: SCHEDULING_NO_STORE },
    )
  }
  return Response.json(
    {
      error: 'BOOKING_FAILED',
      message: schedulingMessage(language, 'Não foi possível concluir esta solicitação agora.', 'This request could not be completed right now.'),
    },
    { status: 500, headers: SCHEDULING_NO_STORE },
  )
}
