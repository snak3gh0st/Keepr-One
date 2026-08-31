import * as Sentry from '@sentry/nextjs'
import { after } from 'next/server'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { getGoogleCalendarEnv, isGoogleCalendarConfigured } from '@/lib/calendar/google/env'
import { drainGoogleCalendarOutbox } from '@/lib/calendar/google/outbox'
import { isEmailDeliveryConfigured } from '@/lib/email/client'
import {
  consumeSchedulingRateLimit,
  createPublicSchedulingBooking,
  publicBookingInputSchema,
  publicSchedulingParamsSchema,
  schedulingErrorResponse,
  schedulingMessage,
  schedulingRequestLanguage,
  schedulingRequestFingerprints,
  SCHEDULING_NO_STORE,
  SCHEDULING_RATE_LIMITS,
} from '@/lib/scheduling'
import { drainSchedulingEmailOutbox } from '@/lib/scheduling/email-outbox'

type RouteContext = { params: Promise<{ slug: string }> }
const MAX_BOOKING_BODY_BYTES = 16_384

function invalidRequest(language: 'PT' | 'EN', message?: string) {
  return Response.json(
    { error: 'INVALID_REQUEST', message: message ?? schedulingMessage(language, 'Revise os dados da reserva.', 'Review the booking details.') },
    { status: 400, headers: SCHEDULING_NO_STORE },
  )
}

export async function POST(request: Request, context: RouteContext) {
  const language = schedulingRequestLanguage(request)
  try {
    assertSameOriginAction({
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    })
  } catch {
    return Response.json(
      { error: 'INVALID_REQUEST', message: schedulingMessage(language, 'Origem da solicitação inválida.', 'Invalid request origin.') },
      { status: 403, headers: SCHEDULING_NO_STORE },
    )
  }

  const params = publicSchedulingParamsSchema.safeParse(await context.params)
  if (!params.success) return invalidRequest(language, schedulingMessage(language, 'Revise o link de agendamento.', 'Review the scheduling link.'))
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BOOKING_BODY_BYTES) {
    return Response.json(
      { error: 'INVALID_REQUEST', message: schedulingMessage(language, 'A solicitação é grande demais.', 'The request is too large.') },
      { status: 413, headers: SCHEDULING_NO_STORE },
    )
  }
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BOOKING_BODY_BYTES) {
    return Response.json(
      { error: 'INVALID_REQUEST', message: schedulingMessage(language, 'A solicitação é grande demais.', 'The request is too large.') },
      { status: 413, headers: SCHEDULING_NO_STORE },
    )
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return invalidRequest(language)
  }
  const body = publicBookingInputSchema.safeParse(json)
  if (!body.success) return invalidRequest(language)

  const fingerprints = schedulingRequestFingerprints(request.headers, {
    pageSlug: params.data.slug,
    email: body.data.email,
  })
  const [addressLimit, emailLimit] = await Promise.all([
    consumeSchedulingRateLimit({
      key: `scheduling-booking-ip:${fingerprints.address}`,
      ...SCHEDULING_RATE_LIMITS.bookingsByAddress,
    }),
    consumeSchedulingRateLimit({
      key: `scheduling-booking-email:${fingerprints.email}`,
      ...SCHEDULING_RATE_LIMITS.bookingsByEmail,
    }),
  ])
  if (!addressLimit.allowed || !emailLimit.allowed) {
    const retryAfter = Math.max(
      addressLimit.allowed ? 0 : addressLimit.retryAfterSeconds,
      emailLimit.allowed ? 0 : emailLimit.retryAfterSeconds,
    )
    return Response.json(
      { error: 'RATE_LIMITED', message: schedulingMessage(language, 'Muitas tentativas. Aguarde um pouco e tente novamente.', 'Too many attempts. Wait a moment and try again.') },
      {
        status: 429,
        headers: { ...SCHEDULING_NO_STORE, 'Retry-After': String(retryAfter) },
      },
    )
  }

  try {
    const result = await createPublicSchedulingBooking(params.data.slug, body.data)
    after(async () => {
      if (isGoogleCalendarConfigured()) {
        try {
          await drainGoogleCalendarOutbox(getGoogleCalendarEnv(), { limit: 10 })
        } catch (error) {
          // The confirmed local booking and its durable sync job remain intact;
          // the regular worker can retry without creating a duplicate event.
          Sentry.captureException(error)
        }
      }
      if (isEmailDeliveryConfigured()) {
        try {
          await drainSchedulingEmailOutbox({ limit: 10 })
        } catch (error) {
          // Resend is outside the booking transaction. A failure leaves the
          // confirmation job pending for the scheduler instead of losing the slot.
          Sentry.captureException(error)
        }
      }
    })
    return Response.json(result, {
      status: result.idempotent ? 200 : 201,
      headers: SCHEDULING_NO_STORE,
    })
  } catch (error) {
    return schedulingErrorResponse(error, language)
  }
}
