import { CalendarDomainError } from '@/lib/calendar/access'
import { checkCalendarConflictPolicy } from '@/lib/calendar/conflicts'
import { prisma } from '@/lib/prisma'
import { createCalendarEvent, getCalendarEventsForRange } from '@/lib/calendar/repository'
import type { CalendarJson, CalendarScheduleInput } from '@/lib/calendar/types'
import { requireCalendarUser } from '@/lib/calendar/google/route-auth'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'no-store' }

function errorResponse(error: unknown) {
  if (error instanceof CalendarDomainError) {
    const status = error.code.includes('NOT_FOUND') ? 404 : error.code === 'REVISION_CONFLICT' ? 409 : 400
    return Response.json({ error: error.code, message: error.message }, { status, headers: NO_STORE })
  }
  return Response.json({ error: 'CALENDAR_REQUEST_FAILED' }, { status: 500, headers: NO_STORE })
}

function parseSchedule(value: unknown): CalendarScheduleInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('schedule is required')
  const input = value as Record<string, unknown>
  if (input.allDay === true) {
    return {
      allDay: true,
      startDate: String(input.startDate ?? ''),
      endDate: String(input.endDate ?? ''),
      timeZone: typeof input.timeZone === 'string' ? input.timeZone : null,
    }
  }
  return {
    allDay: false,
    startsAt: new Date(String(input.startsAt ?? '')),
    endsAt: new Date(String(input.endsAt ?? '')),
    timeZone: String(input.timeZone ?? ''),
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireCalendarUser()
    const query = new URL(request.url).searchParams
    const start = new Date(query.get('start') ?? '')
    const end = new Date(query.get('end') ?? '')
    const caseId = query.get('caseId') ?? undefined
    const events = await getCalendarEventsForRange({ ownerUserId: user.userId, start, end, caseId })
    return Response.json({ events }, { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
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
    const schedule = parseSchedule(body.schedule)
    const calendarUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { timeZone: true } })
    if (!calendarUser) throw new CalendarDomainError('CONNECTION_NOT_FOUND', 'Usuário da agenda não encontrado.')
    const conflictGuard = await checkCalendarConflictPolicy({
      ownerUserId: user.userId,
      schedule,
      userTimeZone: calendarUser.timeZone,
      allowConflict: body.allowConflict === true,
      conflictOverrideToken: typeof body.conflictOverrideToken === 'string' ? body.conflictOverrideToken : undefined,
    })
    if (!conflictGuard.ok) {
      return Response.json(conflictGuard, { status: 409, headers: NO_STORE })
    }
    const event = await createCalendarEvent({
      ownerUserId: user.userId,
      calendarId: typeof body.calendarId === 'string' ? body.calendarId : undefined,
      caseId: typeof body.caseId === 'string' ? body.caseId : null,
      title: String(body.title ?? ''),
      description: typeof body.description === 'string' ? body.description : null,
      schedule,
      location: typeof body.location === 'string' ? body.location : null,
      createGoogleMeet: body.createGoogleMeet === true,
      attendees: Array.isArray(body.attendees)
        ? body.attendees.map((value) => {
            const attendee = value as Record<string, unknown>
            return { email: String(attendee.email ?? ''), name: typeof attendee.name === 'string' ? attendee.name : null }
          })
        : [],
      recurrence: Array.isArray(body.recurrence) ? body.recurrence.map(String) : [],
      reminders: (body.reminders ?? null) as CalendarJson,
      sendInvites: body.sendInvites === true,
      recurrenceScope:
        body.recurrenceScope === 'THIS_EVENT' ||
        body.recurrenceScope === 'THIS_AND_FOLLOWING' ||
        body.recurrenceScope === 'SERIES'
          ? body.recurrenceScope
          : undefined,
    })
    return Response.json({ event }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}
