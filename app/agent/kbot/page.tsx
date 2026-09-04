import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { Shell } from '@/components/Shell'
import Link from 'next/link'
import { getServerI18n } from '@/lib/i18n/server'
import { FollowupWorkspace } from './FollowupWorkspace'
export const dynamic = 'force-dynamic'
export default async function KBotPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUniqueOrThrow({ where: { id: agent.userId }, select: { name: true } })
  const { copy } = await getServerI18n()
  return <Shell role="AGENT" userName={user.name}>
    <header className="flex flex-wrap items-end justify-between gap-4 py-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-deep">K-Bot</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{copy('Sua próxima ação', 'Your next action')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{copy('Priorize os contatos, resolva bloqueios e acompanhe os resultados.', 'Prioritize contacts, resolve blockers and track results.')}</p>
      </div>
      <Link href="/agent/integrations/national-life" className="inline-flex min-h-11 items-center rounded-xl border border-border-steel bg-panel px-4 text-sm font-semibold text-teal-deep">{copy('Conexão National Life', 'National Life connection')}</Link>
    </header>
    <FollowupWorkspace />
  </Shell>
}
