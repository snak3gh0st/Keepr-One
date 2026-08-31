import {
  getPublicSchedulingAvailability,
  publicSchedulingParamsSchema,
  publicSlotsQuerySchema,
  schedulingErrorResponse,
  schedulingRequestFingerprints,
  consumeSchedulingRateLimit,
  SCHEDULING_NO_STORE,
  SCHEDULING_RATE_LIMITS,
} from '@/lib/scheduling'

type RouteContext = { params: Promise<{ slug: string }> }
const ALLOWED_QUERY = new Set(['from', 'days', 'timeZone'])

export async function GET(request: Request, context: RouteContext) {
  const params = publicSchedulingParamsSchema.safeParse(await context.params)
  const url = new URL(request.url)
  if (!params.success || [...url.searchParams.keys()].some((key) => !ALLOWED_QUERY.has(key))) {
    return Response.json(
      { error: 'INVALID_REQUEST', message: 'Revise o link de agendamento.' },
      { status: 400, headers: SCHEDULING_NO_STORE },
    )
  }
  const query = publicSlotsQuerySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    days: url.searchParams.get('days') ?? undefined,
    timeZone: url.searchParams.get('timeZone') ?? undefined,
  })
  if (!query.success) {
    return Response.json(
      { error: 'INVALID_REQUEST', message: 'Período ou fuso horário inválido.' },
      { status: 400, headers: SCHEDULING_NO_STORE },
    )
  }

  const fingerprint = schedulingRequestFingerprints(request.headers, {
    pageSlug: params.data.slug,
  })
  const limit = await consumeSchedulingRateLimit({
    key: `scheduling-slots:${fingerprint.address}`,
    ...SCHEDULING_RATE_LIMITS.slotsByAddress,
  })
  if (!limit.allowed) {
    return Response.json(
      { error: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde um pouco e tente novamente.' },
      {
        status: 429,
        headers: {
          ...SCHEDULING_NO_STORE,
          'Retry-After': String(limit.retryAfterSeconds),
        },
      },
    )
  }

  try {
    const result = await getPublicSchedulingAvailability({
      slug: params.data.slug,
      from: query.data.from,
      days: query.data.days,
      viewerTimeZone: query.data.timeZone,
    })
    return Response.json(result, { headers: SCHEDULING_NO_STORE })
  } catch (error) {
    return schedulingErrorResponse(error)
  }
}
