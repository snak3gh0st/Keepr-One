import { GoogleCalendarClient } from '@/lib/calendar/google/client'
import { getGoogleAccessToken } from '@/lib/calendar/google/credentials'
import { getGoogleCalendarEnv } from '@/lib/calendar/google/env'
import { requireCalendarUser } from '@/lib/calendar/google/route-auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  try {
    const user = await requireCalendarUser()
    const body = (await request.json()) as Record<string, unknown>
    const requested = Array.isArray(body.calendarIds) ? body.calendarIds.map(String) : []
    const sources = await prisma.calendarSource.findMany({
      where: { id: { in: requested }, visible: true, integration: { userId: user.userId, status: 'CONNECTED' } },
      select: { integrationId: true, providerCalendarId: true },
    })
    if (!sources.length || sources.length !== new Set(requested).size) {
      return Response.json({ error: 'CALENDAR_NOT_FOUND' }, { status: 404 })
    }
    const integrationIds = new Set(sources.map((source) => source.integrationId))
    if (integrationIds.size !== 1) return Response.json({ error: 'INVALID_CALENDAR_SET' }, { status: 400 })
    const accessToken = await getGoogleAccessToken(sources[0].integrationId, getGoogleCalendarEnv())
    const result = await new GoogleCalendarClient({ accessToken }).freeBusy({
      timeMin: String(body.timeMin ?? ''),
      timeMax: String(body.timeMax ?? ''),
      timeZone: typeof body.timeZone === 'string' ? body.timeZone : undefined,
      calendarIds: sources.map((source) => source.providerCalendarId),
    })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'FREE_BUSY_FAILED' }, { status: 400 })
  }
}
