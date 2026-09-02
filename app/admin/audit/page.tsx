import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { diffAuditFields } from '@/lib/audit-diff'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { AuditTable } from './AuditTable'
import { getServerI18n } from '@/lib/i18n/server'
import { formatDate, formatNumber } from '@/lib/i18n/format'

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const logs = await prisma.auditLog.findMany({
    include: { user: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const actionLabels: Record<string, string> = {
    UPDATE_AGENT_HIERARCHY: copy('Hierarquia atualizada', 'Hierarchy updated'),
    UPSERT_COMMISSION_PLAN: copy('Plano de comissão salvo', 'Commission plan saved'),
  }
  const rows = logs.map((log) => ({
    id: log.id,
    createdAt: formatDate(log.createdAt, language, {
      dateStyle: 'short',
      timeStyle: 'short',
    }),
    userName: log.user.name,
    userRole: log.user.role,
    actionLabel: actionLabels[log.action] ?? log.action,
    diffs: diffAuditFields(log.before, log.after),
  }))

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={copy('Auditoria', 'Audit')}
        eyebrow={copy('Controle', 'Controls')}
        description={copy(
          'Últimas 100 alterações de hierarquia e planos de comissão, com o valor antes e depois de cada mudança.',
          'The latest 100 hierarchy and commission plan changes, including the value before and after each update.',
        )}
      />
      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section>
          <AuditTable rows={rows} />
        </section>
        <ContextPanel eyebrow={copy('Rastreabilidade', 'Traceability')} title={copy('O que fica registrado', 'What is recorded')}><p>{copy('Cada mudança mostra quem fez, quando fez e quais valores foram alterados.', 'Each change shows who made it, when it happened, and which values changed.')}</p><div className="mt-5 border-t border-white/10 pt-4"><p className="font-mono text-2xl text-paper">{formatNumber(logs.length, language)}</p><p className="mt-1 text-xs text-paper/45">{copy('eventos recentes', 'recent events')}</p></div></ContextPanel>
      </div>
    </Shell>
  )
}
