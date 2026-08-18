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

  if (config) {
    try {
      const { userId } = await provisionAgentInbox(prismaProvisionDeps(prisma, config), {
        agentId: agent.id,
        agentName: user?.name ?? 'Agente',
        agentEmail: user?.email ?? `agent-${agent.id}@keeprone.com`,
      })
      // Minted per page load and short-lived by design: it is a login, and a login
      // that survives in history is a login someone else can replay.
      inboxUrl = await createChatwootClient({
        baseUrl: config.baseUrl,
        platformToken: config.platformToken,
        http: (url, init) => fetch(url, init),
      }).createSsoUrl({ userId })
      const whatsapp = whatsappConfigFromEnv(process.env)
      if (whatsapp) {
        whatsappConnected =
          (await createWhatsappClient({ ...whatsapp, http: (url, init) => fetch(url, init) })
            .connectionState({ agentId: agent.id })
            .catch(() => 'close')) === 'open'
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

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      {inboxUrl && whatsappConnected ? (
        <InboxFrame src={inboxUrl} />
      ) : inboxUrl ? (
        <>
          <PageHeader
            title="Mensagens"
            eyebrow="Conversa com seus clientes"
            description="Fale com quem já está na sua carteira, sem sair do Keepr One."
          />
          <ConnectWhatsapp />
        </>
      ) : (
        <>
        <PageHeader
          title="Mensagens"
          eyebrow="Conversa com seus clientes"
          description="Fale com quem já está na sua carteira, sem sair do Keepr One."
        />
        <EmptyState>
          {failed
            ? 'Não foi possível abrir suas mensagens agora. Tente de novo em alguns instantes — nada do que você enviou foi perdido.'
            : 'Assim que a conversa com clientes for liberada para a sua conta, ela aparece aqui.'}
        </EmptyState>
        </>
      )}
    </Shell>
  )
}
