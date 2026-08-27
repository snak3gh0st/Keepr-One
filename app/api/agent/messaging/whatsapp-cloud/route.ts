import { Prisma } from '@prisma/client'
import { getCurrentAgentWithoutOnboarding } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { chatwootConfigFromEnv } from '@/lib/messaging/chatwoot-config'
import { createChatwootClient } from '@/lib/messaging/chatwoot-client'
import { whatsappChannelModeFromEnv } from '@/lib/messaging/channel-mode'
import { ensureAgentInbox } from '@/lib/messaging/ensure-agent-inbox'

const NO_STORE = { 'Cache-Control': 'no-store' }

function normalizePhone(value: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
}

/// Confirms the result of Chatwoot's official Meta Embedded Signup. Keepr One
/// never receives the Meta access token: Chatwoot owns it, while Keepr stores
/// only enough non-secret identity to enforce one number/inbox per agent.
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

  if (whatsappChannelModeFromEnv(process.env) !== 'META_CLOUD') {
    return Response.json({ error: 'OFFICIAL_CHANNEL_DISABLED' }, { status: 409, headers: NO_STORE })
  }

  const config = chatwootConfigFromEnv(process.env)
  if (!config) return Response.json({ error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })

  const agent = await getCurrentAgentWithoutOnboarding()
  try {
    await ensureAgentInbox({ agentId: agent.id, userId: agent.userId })
  } catch (error) {
    console.error('[whatsapp-cloud] inbox provisioning failed', error)
    return Response.json(
      { error: 'CHATWOOT_ACCOUNT_NOT_READY' },
      { status: 502, headers: NO_STORE },
    )
  }
  const account = await prisma.agentMessagingAccount.findUnique({
    where: { agentId: agent.id },
    select: { externalAccountId: true, externalUserToken: true },
  })
  if (!account?.externalUserToken) {
    return Response.json({ error: 'CHATWOOT_ACCOUNT_NOT_READY' }, { status: 409, headers: NO_STORE })
  }

  try {
    const inboxes = await createChatwootClient({
      baseUrl: config.baseUrl,
      platformToken: config.platformToken,
      http: (url, init) => fetch(url, init),
    }).listWhatsappInboxes({
      accountId: account.externalAccountId,
      userAccessToken: account.externalUserToken,
    })

    const official = inboxes.filter((inbox) => inbox.provider === 'whatsapp_cloud')
    if (official.length === 0) {
      return Response.json({ error: 'WHATSAPP_INBOX_NOT_CONNECTED' }, { status: 409, headers: NO_STORE })
    }
    if (official.length > 1) {
      return Response.json({ error: 'MULTIPLE_WHATSAPP_INBOXES' }, { status: 409, headers: NO_STORE })
    }

    const inbox = official[0]
    const phone = normalizePhone(inbox.phoneNumber)
    if (!phone) {
      return Response.json({ error: 'WHATSAPP_PHONE_NOT_VERIFIED' }, { status: 409, headers: NO_STORE })
    }

    const now = new Date()
    await prisma.agentMessagingChannel.upsert({
      where: { agentId_kind: { agentId: agent.id, kind: 'WHATSAPP' } },
      create: {
        agentId: agent.id,
        kind: 'WHATSAPP',
        provider: 'META_CLOUD',
        status: 'CONNECTED',
        normalizedPhoneE164: phone,
        externalInboxId: `${account.externalAccountId}:${inbox.id}`,
        verifiedAt: now,
        lastHealthCheckAt: now,
      },
      update: {
        provider: 'META_CLOUD',
        status: 'CONNECTED',
        normalizedPhoneE164: phone,
        externalInboxId: `${account.externalAccountId}:${inbox.id}`,
        externalPhoneNumberId: null,
        evolutionInstanceName: null,
        verifiedAt: now,
        lastHealthCheckAt: now,
        lastErrorCode: null,
      },
    })

    return Response.json({ status: 'CONNECTED', phone }, { headers: NO_STORE })
  } catch (error) {
    console.error('[whatsapp-cloud] verification failed', error)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return Response.json({ error: 'PHONE_ALREADY_CONNECTED' }, { status: 409, headers: NO_STORE })
    }
    return Response.json({ error: 'VERIFY_FAILED' }, { status: 502, headers: NO_STORE })
  }
}
