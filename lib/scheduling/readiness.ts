import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { GOOGLE_CALENDAR_OPTIONAL_SCOPES } from '@/lib/calendar/constants'
import { isEmailDeliveryConfigured } from '@/lib/email/client'

type ReadinessDb = Pick<PrismaClient, 'calendarIntegration'>

export type SchedulingReadiness = {
  googleConnected: boolean
  freeBusyGranted: boolean
  writableDefaultCalendar: boolean
  confirmationEmailReady: boolean
  canEnable: boolean
}

export type SchedulingCalendarConnection = {
  status: string
  grantedScopes: string[]
  calendars: Array<{
    visible: boolean
    crmDefault: boolean
    accessRole: string | null
  }>
} | null

const WRITABLE_ROLES = new Set(['owner', 'writer'])

export function evaluateSchedulingReadiness(
  integration: SchedulingCalendarConnection,
  confirmationEmailReady = false,
): SchedulingReadiness {
  const googleConnected = integration?.status === 'CONNECTED'
  const freeBusyGranted = Boolean(
    googleConnected && integration?.grantedScopes.includes(GOOGLE_CALENDAR_OPTIONAL_SCOPES[0]),
  )
  const writableDefaultCalendar = Boolean(
    googleConnected && integration?.calendars.some((calendar) =>
      calendar.visible && calendar.crmDefault && Boolean(
        calendar.accessRole && WRITABLE_ROLES.has(calendar.accessRole),
      ),
    ),
  )
  const hasVisibleConflictCalendar = Boolean(
    googleConnected && integration?.calendars.some((calendar) => calendar.visible),
  )
  return {
    googleConnected,
    freeBusyGranted,
    writableDefaultCalendar,
    confirmationEmailReady,
    canEnable:
      googleConnected && freeBusyGranted && writableDefaultCalendar &&
      hasVisibleConflictCalendar && confirmationEmailReady,
  }
}

export async function getSchedulingReadinessForUser(
  ownerUserId: string,
  db: ReadinessDb = prisma,
) {
  const integration = await db.calendarIntegration.findUnique({
    where: { userId_provider: { userId: ownerUserId, provider: 'GOOGLE' } },
    select: {
      status: true,
      grantedScopes: true,
      calendars: {
        select: {
          visible: true,
          crmDefault: true,
          accessRole: true,
        },
      },
    },
  })
  return evaluateSchedulingReadiness(integration, isEmailDeliveryConfigured())
}
