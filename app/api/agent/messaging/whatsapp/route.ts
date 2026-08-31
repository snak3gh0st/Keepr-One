import { prisma } from '@/lib/prisma'
import { getCurrentAgentWithoutOnboarding } from '@/lib/agent-context'
import { whatsappConfigFromEnv } from '@/lib/messaging/whatsapp-config'
import {
  createWhatsappClient,
  instanceNameFor,
  WhatsappRequestError,
} from '@/lib/messaging/whatsapp-client'
import { Prisma } from '@prisma/client'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { whatsappChannelModeFromEnv } from '@/lib/messaging/channel-mode'
import { ensureAgentInbox } from '@/lib/messaging/ensure-agent-inbox'

const NO_STORE = { 'Cache-Control': 'no-store' }

async function recordChannelFailure(agentId: string, errorCode: string) {
  await prisma.agentMessagingChannel.upsert({
    where: { agentId_kind: { agentId, kind: 'WHATSAPP' } },
    create: {
      agentId,
      kind: 'WHATSAPP',
      provider: 'EVOLUTION',
      status: 'FAILED',
      evolutionInstanceName: instanceNameFor(agentId),
      lastHealthCheckAt: new Date(),
      lastErrorCode: errorCode,
    },
    update: {
      status: 'DEGRADED',
      lastHealthCheckAt: new Date(),
      lastErrorCode: errorCode,
    },
  }).catch(() => undefined)
}

export async function GET() {
  const agent = await getCurrentAgentWithoutOnboarding()
  if (whatsappChannelModeFromEnv(process.env) !== 'EVOLUTION') {
    return Response.json({ error: 'LEGACY_CHANNEL_DISABLED' }, { status: 409, headers: NO_STORE })
  }
  const config = whatsappConfigFromEnv(process.env)
  if (!config) return Response.json({ error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })

  const client = createWhatsappClient({ ...config, http: (url, init) => fetch(url, init) })
  try {
    const state = await client.connectionState({ agentId: agent.id })
    const identity = state === 'open'
      ? await client.connectionIdentity({ agentId: agent.id })
      : null
    const connected = state === 'open' && identity !== null
    const channel = await prisma.agentMessagingChannel.findUnique({
      where: { agentId_kind: { agentId: agent.id, kind: 'WHATSAPP' } },
      select: {
        provider: true,
        status: true,
        normalizedPhoneE164: true,
        evolutionInstanceName: true,
      },
    })
    const status = connected
      ? 'CONNECTED'
      : state === 'close'
        ? 'DISCONNECTED'
        : state === 'open'
          ? 'DEGRADED'
          : 'WAITING_FOR_USER'
    const recorded = connected
      && channel?.provider === 'EVOLUTION'
      && channel.status === 'CONNECTED'
      && channel.normalizedPhoneE164 === identity.normalizedPhoneE164
      && channel.evolutionInstanceName === instanceNameFor(agent.id)

    return Response.json({
      state,
      status,
      phone: connected ? identity.normalizedPhoneE164 : null,
      recorded,
    }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof WhatsappRequestError && error.status === 404) {
      return Response.json({
        state: 'close',
        status: 'DISCONNECTED',
        phone: null,
        recorded: false,
      }, { headers: NO_STORE })
    }
    console.error('[whatsapp] status failed', error)
    return Response.json({ error: 'STATUS_UNAVAILABLE' }, { status: 502, headers: NO_STORE })
  }
}

/// The agent connects; nothing is provisioned on their behalf beforehand. Creating
/// a session they never asked for leaves an instance nobody can point a camera at,
/// which is exactly what happened when this was automatic.
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
  const agent = await getCurrentAgentWithoutOnboarding()
  if (whatsappChannelModeFromEnv(process.env) !== 'EVOLUTION') {
    return Response.json({ error: 'LEGACY_CHANNEL_DISABLED' }, { status: 409, headers: NO_STORE })
  }
  const config = whatsappConfigFromEnv(process.env)
  if (!config) return Response.json({ error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })

  const client = createWhatsappClient({ ...config, http: (url, init) => fetch(url, init) })

  try {
    await ensureAgentInbox({ agentId: agent.id, userId: agent.userId })

    // Creating an instance that already exists answers 403; only that exact state
    // is an idempotent reconnect. Authentication, network and provider failures
    // must remain visible.
    try {
      await client.createInstance({ agentId: agent.id })
    } catch (error) {
      if (!(error instanceof WhatsappRequestError) || error.status !== 403) throw error
    }

    const link = await prisma.agentMessagingAccount.findUnique({
      where: { agentId: agent.id },
      select: { externalAccountId: true, externalUserToken: true },
    })
    // A row without a token predates it being saved. Linking with an empty
    // token fails Chatwoot auth silently and the agent never finds out why
    // their WhatsApp never shows up in the inbox.
    if (!link?.externalUserToken) throw new Error('CHATWOOT_ACCOUNT_NOT_READY')
    await client.enforcePrivateChatSettings({ agentId: agent.id })
    await client.linkToInbox({
      agentId: agent.id,
      chatwootAccountId: link.externalAccountId,
      chatwootUserToken: link.externalUserToken,
      chatwootUrl: process.env.CHATWOOT_BASE_URL ?? '',
    })

    const [qr, state, identity] = await Promise.all([
      client.fetchQrCode({ agentId: agent.id }),
      client.connectionState({ agentId: agent.id }),
      client.connectionIdentity({ agentId: agent.id }),
    ])
    const connected = state === 'open' && identity !== null
    const connectedIdentity = connected ? identity : null
    const now = new Date()
    await prisma.agentMessagingChannel.upsert({
      where: { agentId_kind: { agentId: agent.id, kind: 'WHATSAPP' } },
      create: {
        agentId: agent.id,
        kind: 'WHATSAPP',
        provider: 'EVOLUTION',
        status: connected ? 'CONNECTED' : 'WAITING_FOR_USER',
        evolutionInstanceName: instanceNameFor(agent.id),
        normalizedPhoneE164: connectedIdentity?.normalizedPhoneE164,
        externalPhoneNumberId: connectedIdentity?.externalPhoneNumberId,
        verifiedAt: connected ? now : null,
        lastHealthCheckAt: now,
      },
      update: {
        provider: 'EVOLUTION',
        status: connected ? 'CONNECTED' : 'WAITING_FOR_USER',
        evolutionInstanceName: instanceNameFor(agent.id),
        normalizedPhoneE164: connectedIdentity?.normalizedPhoneE164 ?? null,
        externalPhoneNumberId: connectedIdentity?.externalPhoneNumberId ?? null,
        externalInboxId: null,
        verifiedAt: connected ? now : undefined,
        lastHealthCheckAt: now,
        lastErrorCode: null,
      },
    })
    return Response.json(
      {
        qr: qr?.image ?? null,
        state,
        status: connected ? 'CONNECTED' : 'WAITING_FOR_USER',
        phone: connectedIdentity?.normalizedPhoneE164 ?? null,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error('[whatsapp] connect failed', error)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      await recordChannelFailure(agent.id, 'PHONE_ALREADY_CONNECTED')
      return Response.json(
        { error: 'PHONE_ALREADY_CONNECTED' },
        { status: 409, headers: NO_STORE },
      )
    }
    const errorCode = error instanceof Error && (
      error.message === 'CHATWOOT_ACCOUNT_NOT_READY'
      || error.message === 'CHATWOOT_UNAVAILABLE'
    )
      ? 'CHATWOOT_ACCOUNT_NOT_READY'
      : 'CONNECT_FAILED'
    await recordChannelFailure(agent.id, errorCode)
    return Response.json({ error: errorCode }, { status: 502, headers: NO_STORE })
  }
}

export async function DELETE(request: Request) {
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

  const agent = await getCurrentAgentWithoutOnboarding()
  if (whatsappChannelModeFromEnv(process.env) !== 'EVOLUTION') {
    return Response.json({ error: 'LEGACY_CHANNEL_DISABLED' }, { status: 409, headers: NO_STORE })
  }
  const config = whatsappConfigFromEnv(process.env)
  if (!config) return Response.json({ error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })

  const client = createWhatsappClient({ ...config, http: (url, init) => fetch(url, init) })
  let logoutError: unknown = null
  try {
    await client.logoutInstance({ agentId: agent.id })
  } catch (error) {
    // Evolution 2.3.7 can return 500 after Baileys has already closed the
    // session. Provider state, not the response code alone, decides success.
    logoutError = error
  }

  try {
    const state = await client.connectionState({ agentId: agent.id })
    if (state !== 'close') throw logoutError ?? new Error('PROVIDER_STILL_CONNECTED')

    const now = new Date()
    await prisma.agentMessagingChannel.upsert({
      where: { agentId_kind: { agentId: agent.id, kind: 'WHATSAPP' } },
      create: {
        agentId: agent.id,
        kind: 'WHATSAPP',
        provider: 'EVOLUTION',
        status: 'DISCONNECTED',
        evolutionInstanceName: instanceNameFor(agent.id),
        lastHealthCheckAt: now,
      },
      update: {
        provider: 'EVOLUTION',
        status: 'DISCONNECTED',
        evolutionInstanceName: instanceNameFor(agent.id),
        normalizedPhoneE164: null,
        externalPhoneNumberId: null,
        verifiedAt: null,
        lastHealthCheckAt: now,
        lastErrorCode: null,
      },
    })
    return Response.json({ state: 'close', status: 'DISCONNECTED' }, { headers: NO_STORE })
  } catch (error) {
    console.error('[whatsapp] disconnect failed', error)
    await recordChannelFailure(agent.id, 'DISCONNECT_FAILED')
    return Response.json({ error: 'DISCONNECT_FAILED' }, { status: 502, headers: NO_STORE })
  }
}
