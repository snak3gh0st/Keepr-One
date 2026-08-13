import { getCalendarConnectionForUser, setCalendarPreferences } from '@/lib/calendar/repository'
import { requireCalendarUser } from '@/lib/calendar/google/route-auth'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET() {
  try {
    const user = await requireCalendarUser()
    return Response.json(
      { connection: await getCalendarConnectionForUser(user.userId) },
      { headers: NO_STORE },
    )
  } catch {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginAction({
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    })
  } catch {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }

  try {
    const user = await requireCalendarUser()
    const body = (await request.json()) as Record<string, unknown>
    const connection = await setCalendarPreferences({
      ownerUserId: user.userId,
      visibleCalendarIds: Array.isArray(body.visibleCalendarIds) ? body.visibleCalendarIds.map(String) : [],
      crmDefaultCalendarId: String(body.crmDefaultCalendarId ?? ''),
    })
    return Response.json({ connection }, { headers: NO_STORE })
  } catch {
    return Response.json({ error: 'CALENDAR_PREFERENCES_FAILED' }, { status: 400, headers: NO_STORE })
  }
}
