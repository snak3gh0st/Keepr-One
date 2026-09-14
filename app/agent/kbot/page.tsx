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
      <div className="flex flex-wrap gap-3">
        {/* A central é onde a conversa acontece, e daqui saíam só os dois
            caminhos laterais — a fila de agendadas e a conexão com a
            seguradora. Quem chegava pelo K-Bot para responder alguém tinha de
            voltar ao menu lateral para achar o caminho, e a tela que fala de
            contatos era justamente a que não levava até eles. */}
        <Link href="/agent/mensagens" className="inline-flex min-h-11 items-center rounded-xl border border-border-steel bg-panel px-4 text-sm font-semibold text-teal-deep">{copy('Central de mensagens', 'Message center')}</Link>
        <Link href="/agent/kbot/agendadas" className="inline-flex min-h-11 items-center rounded-xl border border-border-steel bg-panel px-4 text-sm font-semibold text-teal-deep">{copy('Mensagens agendadas', 'Scheduled messages')}</Link>
        <Link href="/agent/integrations/national-life" className="inline-flex min-h-11 items-center rounded-xl border border-border-steel bg-panel px-4 text-sm font-semibold text-teal-deep">{copy('Conexão National Life', 'National Life connection')}</Link>
      </div>
    </header>
    <FollowupWorkspace />
  </Shell>
}
