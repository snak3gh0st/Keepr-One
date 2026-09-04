import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentChatwootContext } from '@/lib/messaging/agent-chatwoot-context'
import { prisma } from '@/lib/prisma'
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const { id } = await ctx.params
    if (!/^\d{1,32}$/.test(id)) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers })
    const agent = await getCurrentAgent()
    const context = await getAgentChatwootContext(agent.id)
    const conversation = await context.chatwoot.getConversation({ accountId: context.accountId, token: context.token, conversationId: id })
    const inboxes = await context.chatwoot.listInboxes({ accountId: context.accountId, token: context.token })
    const inbox = inboxes.find(i => i.id === conversation.inboxId)
    const channel = await prisma.agentMessagingChannel.findUnique({ where: { agentId_kind: { agentId: agent.id, kind: 'WHATSAPP' } }, select: { status: true } })
    if (!inbox || conversation.id !== id || (inbox.kind === 'WHATSAPP' && channel?.status !== 'CONNECTED')) return Response.json({ error: 'UNAVAILABLE' }, { status: 404, headers })
    return Response.json({ conversation }, { headers })
  } catch { return Response.json({ error: 'MESSAGING_UNAVAILABLE' }, { status: 503, headers }) }
}
