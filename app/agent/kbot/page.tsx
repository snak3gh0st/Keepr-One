import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { getServerI18n } from '@/lib/i18n/server'
import { FollowupWorkspace } from './FollowupWorkspace'
export const dynamic = 'force-dynamic'
export default async function KBotPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUniqueOrThrow({ where: { id: agent.userId }, select: { name: true } })
  const { copy } = await getServerI18n()
  return <Shell role="AGENT" userName={user.name}><PageHeader title={copy('Ações e atividades do K-Bot', 'K-Bot actions and activities')} description={copy('Acompanhe pendências, faça contato manual ou delegue o follow-up à IA.', 'Track pending items, contact manually or delegate follow-up to AI.')} /><FollowupWorkspace /></Shell>
}
