import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentChatwootContext } from '@/lib/messaging/agent-chatwoot-context'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const paramsSchema = z.strictObject({ id: z.string().regex(/^\d+$/).max(32) })

export async function POST(request: Request, routeContext: { params: Promise<{ id: string }> }) {
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

  const params = paramsSchema.safeParse(await routeContext.params)
  if (!params.success) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })

  try {
    const agent = await getCurrentAgent()
    const context = await getAgentChatwootContext(agent.id)
    await context.chatwoot.markRead({
      accountId: context.accountId,
      token: context.token,
      conversationId: params.data.id,
    })
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (error) {
    console.error('[messaging] mark read failed', error)
    return Response.json({ error: 'MESSAGING_REQUEST_FAILED' }, { status: 502, headers: NO_STORE })
  }
}
