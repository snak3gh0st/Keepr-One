import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/Table'
import { chatwootConfigFromEnv } from '@/lib/messaging/chatwoot-config'
import { prismaProvisionDeps } from '@/lib/messaging/provision-prisma'
import { provisionAgentInbox } from '@/lib/messaging/provision-agent-inbox'
import { createChatwootClient } from '@/lib/messaging/chatwoot-client'
import { InboxFrame } from './InboxFrame'
import { ConnectWhatsapp } from './ConnectWhatsapp'
import { whatsappConfigFromEnv } from '@/lib/messaging/whatsapp-config'
import { createWhatsappClient } from '@/lib/messaging/whatsapp-client'
import { whatsappChannelModeFromEnv } from '@/lib/messaging/channel-mode'
import { ConnectOfficialWhatsapp } from './ConnectOfficialWhatsapp'

export const dynamic = 'force-dynamic'

export default async function MensagensPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const config = chatwootConfigFromEnv(process.env)

  // Unconfigured is a state, not a failure: a deployment that has not adopted
  // messaging shows the screen explaining that, never a broken frame.
  let inboxUrl: string | null = null
  let failed = false
  // The inbox is only worth showing once a channel reaches it. Before that the page
  // is the connect screen, not an empty Chatwoot asking the agent to configure it.
  let whatsappConnected = false
  const channelMode = whatsappChannelModeFromEnv(process.env)

  if (config) {
    try {
      const { accountId, userId } = await provisionAgentInbox(prismaProvisionDeps(prisma, config), {
        agentId: agent.id,
        agentName: user?.name ?? 'Agente',
        agentEmail: user?.email ?? `agent-${agent.id}@keeprone.com`,
      })
      // Minted per page load and short-lived by design: it is a login, and a login
      // that survives in history is a login someone else can replay.
      const chatwoot = createChatwootClient({
        baseUrl: config.baseUrl,
        platformToken: config.platformToken,
        http: (url, init) => fetch(url, init),
      })
      inboxUrl = await chatwoot.createSsoUrl({ userId })
      const channel = await prisma.agentMessagingChannel.findUnique({
        where: { agentId: agent.id },
        select: { provider: true, status: true, externalPhoneNumberId: true, externalInboxId: true },
      })
      if (channelMode === 'META_CLOUD') {
        const account = await prisma.agentMessagingAccount.findUnique({
          where: { agentId: agent.id },
          select: { externalUserToken: true },
        })
        const officialInboxes = account?.externalUserToken
          ? await chatwoot.listWhatsappInboxes({
              accountId,
              userAccessToken: account.externalUserToken,
            }).catch((error) => {
              console.error('[mensagens] WhatsApp Cloud health check failed', error)
              return []
            })
          : []
        whatsappConnected = channel?.provider === 'META_CLOUD'
          && channel.status === 'CONNECTED'
          && Boolean(channel.externalInboxId)
          && officialInboxes.length === 1
          && channel.externalInboxId === `${accountId}:${officialInboxes[0]?.id}`
      } else {
        const whatsapp = whatsappConfigFromEnv(process.env)
        if (whatsapp) {
          const providerState = await createWhatsappClient({
            ...whatsapp,
            http: (url, init) => fetch(url, init),
          })
            .connectionState({ agentId: agent.id })
            .catch(() => 'close')
          whatsappConnected = providerState === 'open'
            && channel?.provider === 'EVOLUTION'
            && channel.status === 'CONNECTED'
            && Boolean(channel.externalPhoneNumberId)
        }
      }
    } catch (error) {
      // Reported, never swallowed. The first version hid a 422 from Chatwoot's
      // password policy behind this screen, and the only symptom an agent had was
      // an inbox that was simply empty — the same silence that made a full disk
      // look like a broken carrier login.
      console.error('[mensagens] provisioning failed', error)
      failed = true
    }
  }

  return renderPage({ userName: user?.name ?? '', failed, inboxUrl, whatsappConnected, channelMode })
}

function renderPage(input: {
  userName: string
  failed: boolean
  inboxUrl: string | null
  whatsappConnected: boolean
  channelMode: 'EVOLUTION' | 'META_CLOUD'
}) {
  return (
    <Shell role="AGENT" userName={input.userName}>
      {input.inboxUrl && input.whatsappConnected ? (
        <InboxFrame src={input.inboxUrl} />
      ) : input.inboxUrl ? (
        <>
          <PageHeader
            title="Mensagens"
            eyebrow="Conversa com seus clientes"
            description="Fale com quem já está na sua carteira, sem sair do Keepr One."
          />
          {input.channelMode === 'META_CLOUD'
            ? <ConnectOfficialWhatsapp setupUrl={input.inboxUrl} />
            : <ConnectWhatsapp />}
        </>
      ) : (
        <>
          <PageHeader
            title="Mensagens"
            eyebrow="Conversa com seus clientes"
            description="Fale com quem já está na sua carteira, sem sair do Keepr One."
          />
          <EmptyState>
            {input.failed
              ? 'Não foi possível abrir suas mensagens agora. Tente de novo em alguns instantes — nada do que você enviou foi perdido.'
              : 'Assim que a conversa com clientes for liberada para a sua conta, ela aparece aqui.'}
          </EmptyState>
        </>
      )}
    </Shell>
  )
}
