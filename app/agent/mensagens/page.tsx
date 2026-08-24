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

export const dynamic = 'force-dynamic'

export default async function MensagensPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const config = chatwootConfigFromEnv(process.env)
  let messagingReady = false
  let failed = false

  if (config) {
    try {
      await provisionAgentInbox(prismaProvisionDeps(prisma, config), {
        agentId: agent.id,
        agentName: user?.name ?? 'Agente',
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
          channelMode={whatsappChannelModeFromEnv(process.env)}
        />
      ) : (
        <>
          <PageHeader
            title="Mensagens"
            eyebrow="Conversa com seus clientes"
            description="WhatsApp e e-mail em uma única caixa, dentro do Keepr One."
          />
          <EmptyState>
            {failed
              ? 'Não foi possível abrir suas mensagens agora. Tente novamente em alguns instantes.'
              : 'Assim que os canais forem liberados para sua conta, eles aparecerão aqui.'}
          </EmptyState>
        </>
      )}
    </Shell>
  )
}
