import { CalendarDomainError } from '@/lib/calendar/access'
import { checkCalendarConflictPolicy } from '@/lib/calendar/conflicts'
import { prisma } from '@/lib/prisma'
import { cancelCalendarEvent, updateCalendarEvent } from '@/lib/calendar/repository'
import type { CalendarJson, CalendarScheduleInput } from '@/lib/calendar/types'
import { requireCalendarUser } from '@/lib/calendar/google/route-auth'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'no-store' }
type Context = { params: Promise<{ id: string }> }

function errorResponse(error: unknown) {
  if (error instanceof CalendarDomainError) {
    const status = error.code.includes('NOT_FOUND') ? 404 : error.code === 'REVISION_CONFLICT' ? 409 : 400
    return Response.json({ error: error.code, message: error.message }, { status, headers: NO_STORE })
  }
  return Response.json({ error: 'CALENDAR_REQUEST_FAILED' }, { status: 500, headers: NO_STORE })
}

function parseOptionalSchedule(value: unknown): CalendarScheduleInput | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid schedule')
  const input = value as Record<string, unknown>
  return input.allDay === true
    ? { allDay: true, startDate: String(input.startDate ?? ''), endDate: String(input.endDate ?? ''), timeZone: typeof input.timeZone === 'string' ? input.timeZone : null }
    : { allDay: false, startsAt: new Date(String(input.startsAt ?? '')), endsAt: new Date(String(input.endsAt ?? '')), timeZone: String(input.timeZone ?? '') }
}

function forbiddenCrossOrigin(request: Request) {
  try {
    assertSameOriginAction({
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    })
    return null
  } catch {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }
}

export async function PATCH(request: Request, context: Context) {
  const forbidden = forbiddenCrossOrigin(request)
  if (forbidden) return forbidden

  try {
    const user = await requireCalendarUser()
    const { id } = await context.params
    const body = (await request.json()) as Record<string, unknown>
    const schedule = parseOptionalSchedule(body.schedule)
    if (schedule) {
      const calendarUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { timeZone: true } })
      if (!calendarUser) throw new CalendarDomainError('EVENT_NOT_FOUND', 'Compromisso não encontrado.')
      const conflictGuard = await checkCalendarConflictPolicy({
        ownerUserId: user.userId,
        eventId: id,
        schedule,
        userTimeZone: calendarUser.timeZone,
        allowConflict: body.allowConflict === true,
        conflictOverrideToken: typeof body.conflictOverrideToken === 'string' ? body.conflictOverrideToken : undefined,
      })
      if (!conflictGuard.ok) {
        return Response.json(conflictGuard, { status: 409, headers: NO_STORE })
      }
    }
    const event = await updateCalendarEvent({
      ownerUserId: user.userId,
      eventId: id,
      baseRevision: Number(body.baseRevision),
      calendarId: typeof body.calendarId === 'string' ? body.calendarId : undefined,
      caseId: body.caseId === null ? null : typeof body.caseId === 'string' ? body.caseId : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      description: body.description === null ? null : typeof body.description === 'string' ? body.description : undefined,
      schedule,
      location: body.location === null ? null : typeof body.location === 'string' ? body.location : undefined,
      createGoogleMeet: typeof body.createGoogleMeet === 'boolean' ? body.createGoogleMeet : undefined,
      attendees: Array.isArray(body.attendees)
        ? body.attendees.map((value) => {
            const attendee = value as Record<string, unknown>
            return { email: String(attendee.email ?? ''), name: typeof attendee.name === 'string' ? attendee.name : null }
          })
        : undefined,
      recurrence: Array.isArray(body.recurrence) ? body.recurrence.map(String) : undefined,
      reminders: body.reminders === undefined ? undefined : (body.reminders as CalendarJson),
      sendInvites: body.sendInvites === true,
      recurrenceScope:
        body.recurrenceScope === 'THIS_EVENT' ||
        body.recurrenceScope === 'THIS_AND_FOLLOWING' ||
        body.recurrenceScope === 'SERIES'
          ? body.recurrenceScope
          : undefined,
    })
    return Response.json({ event }, { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  const forbidden = forbiddenCrossOrigin(request)
  if (forbidden) return forbidden

  try {
    const user = await requireCalendarUser()
    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const event = await cancelCalendarEvent({
      ownerUserId: user.userId,
      eventId: id,
      baseRevision: Number(body.baseRevision),
      sendInvites: body.sendInvites === true,
      recurrenceScope:
        body.recurrenceScope === 'THIS_EVENT' ||
        body.recurrenceScope === 'THIS_AND_FOLLOWING' ||
        body.recurrenceScope === 'SERIES'
          ? body.recurrenceScope
          : undefined,
    })
    return Response.json({ event }, { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}
