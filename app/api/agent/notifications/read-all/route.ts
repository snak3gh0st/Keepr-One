import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

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

  let userId: string
  try {
    const session = await requireRole('ADMIN', 'AGENT')
    userId = session.user.id
  } catch {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })
  }

  try {
    const readAt = new Date()
    const updated = await prisma.notification.updateMany({
      where: { recipientUserId: userId, readAt: null },
      data: { readAt },
    })
    return Response.json(
      { updatedCount: updated.count, readAt: readAt.toISOString() },
      { status: 200, headers: NO_STORE },
    )
  } catch {
    return Response.json(
      { error: 'NOTIFICATION_UPDATE_FAILED' },
      { status: 500, headers: NO_STORE },
    )
  }
}
