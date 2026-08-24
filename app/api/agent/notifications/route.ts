import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function notificationLimit(request: Request) {
  const raw = new URL(request.url).searchParams.get('limit')
  if (!raw) return DEFAULT_LIMIT
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

export async function GET(request: Request) {
  let userId: string
  try {
    const session = await requireRole('ADMIN', 'AGENT')
    // This is deliberately the authenticated User.id. Notifications are a
    // private inbox, not an agent/downline resource.
    userId = session.user.id
  } catch {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })
  }

  try {
    const [notifications, unreadCount] = await prisma.$transaction([
      prisma.notification.findMany({
        where: { recipientUserId: userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: notificationLimit(request),
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          href: true,
          caseId: true,
          followUpId: true,
          calendarEventId: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({
        where: { recipientUserId: userId, readAt: null },
      }),
    ])

    return Response.json(
      {
        notifications: notifications.map((notification) => ({
          ...notification,
          readAt: notification.readAt?.toISOString() ?? null,
          createdAt: notification.createdAt.toISOString(),
        })),
        unreadCount,
      },
      { status: 200, headers: NO_STORE },
    )
  } catch {
    return Response.json(
      { error: 'NOTIFICATIONS_NOT_AVAILABLE' },
      { status: 500, headers: NO_STORE },
    )
  }
}
