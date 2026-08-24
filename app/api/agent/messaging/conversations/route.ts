import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentChatwootContext, AgentMessagingUnavailableError } from '@/lib/messaging/agent-chatwoot-context'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const STATUSES = new Set(['all', 'open', 'resolved', 'pending', 'snoozed'])

export async function GET(request: Request) {
  try {
    const agent = await getCurrentAgent()
    const context = await getAgentChatwootContext(agent.id)
    const params = new URL(request.url).searchParams
    const statusInput = params.get('status') ?? 'all'
    const status = STATUSES.has(statusInput)
      ? statusInput as 'all' | 'open' | 'resolved' | 'pending' | 'snoozed'
      : 'all'
    const inboxId = params.get('inboxId')?.trim() || undefined
    const query = params.get('q')?.trim().slice(0, 120) || undefined
    const page = Math.max(1, Math.min(100, Number(params.get('page')) || 1))

    const [inboxes, result] = await Promise.all([
      context.chatwoot.listInboxes({ accountId: context.accountId, token: context.token }),
      context.chatwoot.listConversations({
        accountId: context.accountId,
        token: context.token,
        status,
        inboxId,
        query,
        page,
      }),
    ])

    const inboxIds = new Set(inboxes.map((inbox) => inbox.id))
    return Response.json({
      inboxes,
      conversations: result.conversations.filter((conversation) => inboxIds.has(conversation.inboxId)),
      total: result.total,
      page,
    }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof AgentMessagingUnavailableError) {
      return Response.json({ error: error.code }, { status: 503, headers: NO_STORE })
    }
    console.error('[messaging] conversation list failed', error)
    return Response.json({ error: 'MESSAGING_REQUEST_FAILED' }, { status: 502, headers: NO_STORE })
  }
}
