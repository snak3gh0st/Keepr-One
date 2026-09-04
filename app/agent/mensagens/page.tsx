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
import { getCurrentSession, getServerI18n } from '@/lib/i18n/server'
import { isReadOnlySupportPreview } from '@/lib/support-preview'

export const dynamic = 'force-dynamic'

export default async function MensagensPage() {
  const { copy } = await getServerI18n()
  const [agent, session] = await Promise.all([getCurrentAgent(), getCurrentSession()])
  const readOnly = isReadOnlySupportPreview(session)
  const [user, existingMessagingAccount] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    readOnly
      ? prisma.agentMessagingAccount.findUnique({
          where: { agentId: agent.id },
          select: { externalUserToken: true },
        })
      : Promise.resolve(null),
  ])
  const config = chatwootConfigFromEnv(process.env)
  let messagingReady = false
  let failed = false

  if (config) {
    if (readOnly) {
      // A support preview may display only an already-linked account. Calling
      // the normal provisioner here would create a Chatwoot user/account on a
      // GET, which violates the preview's read-only contract.
      messagingReady = Boolean(existingMessagingAccount?.externalUserToken)
    } else {
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
  }

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      {messagingReady ? (
        <MessagingWorkspace
          channelMode={whatsappChannelModeFromEnv(process.env)}
          readOnly={readOnly}
        />
      ) : (
        <>
          <PageHeader
            title={copy('Mensagens', 'Messages')}
            eyebrow={copy('Conversa com seus clientes', 'Conversations with your clients')}
            description={copy('WhatsApp e e-mail em uma única caixa, dentro do Keepr One.', 'WhatsApp and email in one inbox, inside Keepr One.')}
          />
          <EmptyState>
            {readOnly
              ? copy('Nenhuma conta de mensagens existente está disponível neste modo de suporte. Nada foi criado.', 'No existing messaging account is available in support mode. Nothing was created.')
              : failed
              ? copy('Não foi possível abrir suas mensagens agora. Tente novamente em alguns instantes.', 'We couldn’t open your messages right now. Please try again in a moment.')
              : copy('Assim que os canais forem liberados para sua conta, eles aparecerão aqui.', 'Your channels will appear here as soon as they are enabled for your account.')}
          </EmptyState>
        </>
      )}
    </Shell>
  )
}
