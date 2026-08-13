import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const paramsSchema = z.strictObject({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
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

  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
  }

  try {
    const readAt = new Date()
    const updated = await prisma.notification.updateMany({
      where: {
        id: parsed.data.id,
        recipientUserId: userId,
        readAt: null,
      },
      data: { readAt },
    })

    if (updated.count === 1) {
      return Response.json(
        { id: parsed.data.id, readAt: readAt.toISOString() },
        { status: 200, headers: NO_STORE },
      )
    }

    // A read notification is an idempotent success. A notification owned by a
    // different user is indistinguishable from a missing one.
    const owned = await prisma.notification.findFirst({
      where: { id: parsed.data.id, recipientUserId: userId },
      select: { id: true, readAt: true },
    })
    if (!owned) return new Response(null, { status: 404, headers: NO_STORE })

    return Response.json(
      { id: owned.id, readAt: owned.readAt?.toISOString() ?? readAt.toISOString() },
      { status: 200, headers: NO_STORE },
    )
  } catch {
    return Response.json(
      { error: 'NOTIFICATION_UPDATE_FAILED' },
      { status: 500, headers: NO_STORE },
    )
  }
}
