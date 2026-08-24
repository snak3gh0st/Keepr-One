import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentChatwootContext, AgentMessagingUnavailableError } from '@/lib/messaging/agent-chatwoot-context'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const paramsSchema = z.strictObject({ id: z.string().regex(/^\d+$/).max(32) })
const messageSchema = z.strictObject({ content: z.string().trim().min(1).max(10_000) })
type Context = { params: Promise<{ id: string }> }

function sameOrigin(request: Request) {
  assertSameOriginAction({
    origin: request.headers.get('origin'),
    host: request.headers.get('host'),
    forwardedHost: request.headers.get('x-forwarded-host'),
    forwardedProto: request.headers.get('x-forwarded-proto'),
  })
}

function unavailable(error: unknown) {
  if (error instanceof AgentMessagingUnavailableError) {
    return Response.json({ error: error.code }, { status: 503, headers: NO_STORE })
  }
  console.error('[messaging] conversation messages failed', error)
  return Response.json({ error: 'MESSAGING_REQUEST_FAILED' }, { status: 502, headers: NO_STORE })
}

export async function GET(request: Request, routeContext: Context) {
  const parsed = paramsSchema.safeParse(await routeContext.params)
  if (!parsed.success) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })

  try {
    const agent = await getCurrentAgent()
    const context = await getAgentChatwootContext(agent.id)
    const before = new URL(request.url).searchParams.get('before')?.trim() || undefined
    const messages = await context.chatwoot.listMessages({
      accountId: context.accountId,
      token: context.token,
      conversationId: parsed.data.id,
      before,
    })
    return Response.json({ messages }, { headers: NO_STORE })
  } catch (error) {
    return unavailable(error)
  }
}

export async function POST(request: Request, routeContext: Context) {
  try {
    sameOrigin(request)
  } catch {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }

  const params = paramsSchema.safeParse(await routeContext.params)
  const body = messageSchema.safeParse(await request.json().catch(() => null))
  if (!params.success || !body.success) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
  }

  try {
    const agent = await getCurrentAgent()
    const context = await getAgentChatwootContext(agent.id)
    const message = await context.chatwoot.sendMessage({
      accountId: context.accountId,
      token: context.token,
      conversationId: params.data.id,
      content: body.data.content,
    })
    return Response.json({ message }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return unavailable(error)
  }
}
