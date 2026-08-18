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

export const dynamic = 'force-dynamic'

export default async function MensagensPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const config = chatwootConfigFromEnv(process.env)

  // Unconfigured is a state, not a failure: a deployment that has not adopted
  // messaging shows the screen explaining that, never a broken frame.
  let inboxUrl: string | null = null
  let failed = false

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
    } catch {
      failed = true
    }
  }

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Mensagens"
        eyebrow="Conversa com seus clientes"
        description="Fale com quem já está na sua carteira, sem sair do Keepr One."
      />
      {inboxUrl ? (
        <InboxFrame src={inboxUrl} />
      ) : (
        <EmptyState>
          {failed
            ? 'Não foi possível abrir suas mensagens agora. Tente de novo em alguns instantes — nada do que você enviou foi perdido.'
            : 'Assim que a conversa com clientes for liberada para a sua conta, ela aparece aqui.'}
        </EmptyState>
      )}
    </Shell>
  )
}
