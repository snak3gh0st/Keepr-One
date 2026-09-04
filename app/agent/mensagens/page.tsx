import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/Table'
import { chatwootConfigFromEnv } from '@/lib/messaging/chatwoot-config'
import { prismaProvisionDeps } from '@/lib/messaging/provision-prisma'
import { provisionAgentInbox } from '@/lib/messaging/provision-agent-inbox'
import { whatsappChannelModeFromEnv } from '@/lib/messaging/channel-mode'
import { MessagingWorkspace } from './MessagingWorkspace'
import { getServerI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export default async function MensagensPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const selected = (await searchParams).conversation
  const initialConversationId = selected && /^\d{1,32}$/.test(selected) ? selected : undefined
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const config = chatwootConfigFromEnv(process.env)
  let messagingReady = false
  let failed = false

  if (config) {
    try {
      await provisionAgentInbox(prismaProvisionDeps(prisma, config), {
        agentId: agent.id,
        agentName: user?.name ?? copy('Agente', 'Agent'),
        agentEmail: user?.email ?? `agent-${agent.id}@keeprone.com`,
      })
      messagingReady = true
    } catch (error) {
      console.error('[mensagens] provisioning failed', error)
      failed = true
    }
  }

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      {messagingReady ? (
        <MessagingWorkspace
          initialConversationId={initialConversationId}
          channelMode={whatsappChannelModeFromEnv(process.env)}
        />
      ) : (
        <>
          <PageHeader
            title={copy('Mensagens', 'Messages')}
            eyebrow={copy('Conversa com seus clientes', 'Conversations with your clients')}
            description={copy('WhatsApp e e-mail em uma única caixa, dentro do Keepr One.', 'WhatsApp and email in one inbox, inside Keepr One.')}
          />
          <EmptyState>
            {failed
              ? copy('Não foi possível abrir suas mensagens agora. Tente novamente em alguns instantes.', 'We couldn’t open your messages right now. Please try again in a moment.')
              : copy('Assim que os canais forem liberados para sua conta, eles aparecerão aqui.', 'Your channels will appear here as soon as they are enabled for your account.')}
          </EmptyState>
        </>
      )}
    </Shell>
  )
}
