import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentChatwootContext, AgentMessagingUnavailableError } from '@/lib/messaging/agent-chatwoot-context'
import { prisma } from '@/lib/prisma'

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

    const [inboxes, result, whatsappChannel] = await Promise.all([
      context.chatwoot.listInboxes({ accountId: context.accountId, token: context.token }),
      context.chatwoot.listConversations({
        accountId: context.accountId,
        token: context.token,
        status,
        inboxId,
        query,
        page,
      }),
      prisma.agentMessagingChannel.findUnique({
        where: { agentId_kind: { agentId: agent.id, kind: 'WHATSAPP' } },
        select: { status: true },
      }),
    ])

    // Chatwoot keeps historical conversations after the provider session is
    // disconnected. They must not remain visible as if WhatsApp were active.
    const visibleInboxes = inboxes.filter((inbox) => (
      inbox.kind !== 'WHATSAPP' || whatsappChannel?.status === 'CONNECTED'
    ))
    const inboxIds = new Set(visibleInboxes.map((inbox) => inbox.id))
    const conversations = result.conversations.filter((conversation) => inboxIds.has(conversation.inboxId))
    return Response.json({
      inboxes: visibleInboxes,
      conversations,
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
