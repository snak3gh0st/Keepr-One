import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { whatsappConfigFromEnv } from '@/lib/messaging/whatsapp-config'
import { createWhatsappClient } from '@/lib/messaging/whatsapp-client'

const NO_STORE = { 'Cache-Control': 'no-store' }

/// The agent connects; nothing is provisioned on their behalf beforehand. Creating
/// a session they never asked for leaves an instance nobody can point a camera at,
/// which is exactly what happened when this was automatic.
export async function POST() {
  const agent = await getCurrentAgent()
  const config = whatsappConfigFromEnv(process.env)
  if (!config) return Response.json({ error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })

  const client = createWhatsappClient({ ...config, http: (url, init) => fetch(url, init) })

  try {
    // Creating an instance that already exists answers 403; that is a reconnect,
    // not a failure, so the QR fetch below still runs.
    await client.createInstance({ agentId: agent.id }).catch(() => {})

    const link = await prisma.agentMessagingAccount.findUnique({
      where: { agentId: agent.id },
      select: { externalAccountId: true },
    })
    if (link) {
      await client
        .linkToInbox({
          agentId: agent.id,
          chatwootAccountId: link.externalAccountId,
          chatwootUserToken: process.env.CHATWOOT_AGENT_TOKEN ?? '',
          chatwootUrl: process.env.CHATWOOT_BASE_URL ?? '',
        })
        .catch(() => {})
    }

    const [qr, state] = await Promise.all([
      client.fetchQrCode({ agentId: agent.id }),
      client.connectionState({ agentId: agent.id }),
    ])
    return Response.json({ qr: qr?.image ?? null, state }, { headers: NO_STORE })
  } catch (error) {
    console.error('[whatsapp] connect failed', error)
    return Response.json({ error: 'CONNECT_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
