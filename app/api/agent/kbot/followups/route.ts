import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { prisma } from '@/lib/prisma'
import { getFollowupCandidates } from '@/lib/kbot-followup/candidates'
import { creditBalance } from '@/lib/kbot-followup/credits'
import { aiEnabled, featureEnabled, FollowupError, TOKEN_RESERVATION } from '@/lib/kbot-followup/domain'
import { cancelBatch, changeContactPreference, openManualConversation, startFollowups, saveFollowupPhone } from '@/lib/kbot-followup/service'
import { getFollowupOutcomes } from '@/lib/kbot-followup/outcomes'
import { followupCatalog } from '@/lib/kbot-followup/billing'

const headers = { 'Cache-Control': 'private, no-store' }
const schema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('phone'), candidateId: z.string().min(1).max(150), fingerprint: z.string().length(64), phone: z.string().min(1).max(40) }),
  z.strictObject({ action: z.literal('start'), requestKey: z.string().uuid(), language: z.enum(['PT', 'EN']),
    candidates: z.array(z.strictObject({ id: z.string().min(1).max(150), fingerprint: z.string().length(64) })).min(1).max(25) }),
  z.strictObject({ action: z.literal('cancel'), batchId: z.string().uuid() }),
  z.strictObject({ action: z.enum(['open', 'snooze', 'optout', 'restore', 'manual']), candidateId: z.string().min(1).max(150) }),
])
export async function GET() {
  try {
    const agent = await getCurrentAgent()
    if (!featureEnabled()) return Response.json({ enabled: false }, { headers })
    const [candidates, balance, jobs, channel, subscription] = await Promise.all([
      getFollowupCandidates(agent.id), creditBalance(agent.id),
      prisma.kBotFollowupJob.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: 'desc' }, take: 100,
        select: { id: true, candidateId: true, sourceHref: true, reason: true, updatedAt: true, batchId: true, customerName: true, status: true, conversationId: true, inputTokens: true, outputTokens: true,
          creditState: true, billedTokens: true, reservedTokens: true, errorCode: true, createdAt: true, content: true } }),
      prisma.agentMessagingChannel.findUnique({ where: { agentId_kind: { agentId: agent.id, kind: 'WHATSAPP' } }, select: { status: true, provider: true } }),
      prisma.platformAddonSubscription.findFirst({ where: { agentId: agent.id, addon: 'K_BOT_FOLLOWUP', stripeSubscriptionId: { not: null }, status: { in: ['ACTIVE', 'PAST_DUE', 'TRIALING'] } }, select: { id: true } }),
    ])
    const { byJob, results } = await getFollowupOutcomes(agent.id, jobs)
    const catalog = followupCatalog()
    return Response.json({ enabled: true, aiAvailable: aiEnabled() && channel?.status === 'CONNECTED' && channel.provider === 'EVOLUTION',
      candidates, balance, jobs: jobs.map(job => ({ ...job, outcome: byJob[job.id] ?? null })), results, reservationPerMessage: TOKEN_RESERVATION,
      catalog: catalog ? { tokens: catalog.tokens, cents: catalog.cents } : null, hasSubscription: !!subscription }, { headers })
  } catch { return Response.json({ error: 'FOLLOWUP_UNAVAILABLE' }, { status: 503, headers }) }
}
export async function POST(request: Request) {
  try {
    assertSameOriginAction({ origin: request.headers.get('origin'), host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'), forwardedProto: request.headers.get('x-forwarded-proto') })
  } catch { return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers }) }
  try {
    const agent = await getCurrentAgent()
    if (!featureEnabled()) throw new FollowupError('FEATURE_DISABLED', 404)
    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) throw new FollowupError('INVALID_REQUEST', 400)
    const input = body.data
    let result: unknown = { ok: true }
    if (input.action === 'start') result = await startFollowups(agent.id, input)
    else if (input.action === 'phone') result = await saveFollowupPhone(agent.id, input)
    else if (input.action === 'cancel') result = await cancelBatch(agent.id, input.batchId)
    else if (input.action === 'open') result = await openManualConversation(agent.id, input.candidateId)
    else await changeContactPreference(agent.id, input.candidateId, input.action)
    return Response.json(result, { headers, status: input.action === 'start' ? 202 : 200 })
  } catch (error) {
    return Response.json({ error: error instanceof FollowupError ? error.code : 'FOLLOWUP_UNAVAILABLE' }, { status: error instanceof FollowupError ? error.status : 503, headers })
  }
}
