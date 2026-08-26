import { getCurrentAgentWithoutOnboarding } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { chatwootConfigFromEnv } from '@/lib/messaging/chatwoot-config'
import { createChatwootClient } from '@/lib/messaging/chatwoot-client'
import { ensureAgentInbox } from '@/lib/messaging/ensure-agent-inbox'

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

  const config = chatwootConfigFromEnv(process.env)
  if (!config) return Response.json({ error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })

  try {
    const agent = await getCurrentAgentWithoutOnboarding()
    await ensureAgentInbox({ agentId: agent.id, userId: agent.userId })
    const account = await prisma.agentMessagingAccount.findUnique({
      where: { agentId: agent.id },
      select: { externalUserId: true },
    })
    if (!account) return Response.json({ error: 'CHATWOOT_ACCOUNT_NOT_READY' }, { status: 409, headers: NO_STORE })

    const url = await createChatwootClient({
      baseUrl: config.baseUrl,
      platformToken: config.platformToken,
      http: (target, init) => fetch(target, init),
    }).createSsoUrl({ userId: account.externalUserId })

    return Response.json({ url }, { headers: NO_STORE })
  } catch (error) {
    console.error('[messaging] setup session failed', error)
    return Response.json({ error: 'SETUP_SESSION_FAILED' }, { status: 502, headers: NO_STORE })
  }
}
