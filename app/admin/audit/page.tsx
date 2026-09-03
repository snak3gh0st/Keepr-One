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
    ADMIN_USER_PROFILE_UPDATED: copy('Perfil de usuário atualizado', 'User profile updated'),
    ADMIN_USER_SUSPENDED: copy('Conta de usuário suspensa', 'User account suspended'),
    ADMIN_USER_RESTORED: copy('Acesso de usuário restaurado', 'User access restored'),
    ADMIN_PASSWORD_RESET_REQUESTED: copy('Redefinição de senha enviada', 'Password reset sent'),
    ADMIN_EMAIL_VERIFICATION_SENT: copy('Verificação de e-mail enviada', 'Email verification sent'),
    ADMIN_USER_EMAIL_CHANGE_REQUESTED: copy('Troca de e-mail solicitada', 'Email change requested'),
    ADMIN_USER_EMAIL_CHANGE_CURRENT_APPROVED: copy('E-mail atual autorizou a troca', 'Current email authorized the change'),
    ADMIN_USER_EMAIL_CHANGE_COMPLETED: copy('Troca de e-mail concluída', 'Email change completed'),
    ADMIN_USER_EMAIL_CHANGE_DELIVERY_FAILED: copy('Falha no envio da troca de e-mail', 'Email change delivery failed'),
    ADMIN_USER_SESSIONS_REVOKED: copy('Sessões de usuário encerradas', 'User sessions revoked'),
    ADMIN_USER_PREVIEW_STARTED: copy('Visualização de suporte iniciada', 'Support preview started'),
    ADMIN_USER_PREVIEW_ENDED: copy('Visualização de suporte encerrada', 'Support preview ended'),
    ADMIN_USER_PREVIEW_FAILED: copy('Falha ao abrir visualização', 'Support preview failed to start'),
    ADMIN_USER_PREVIEW_STOP_FAILED: copy('Falha ao encerrar visualização', 'Support preview failed to end'),
    ADMIN_USER_PLAN_CHANGED: copy('Plano do usuário alterado', 'User plan changed'),
    ADMIN_USER_PLAN_RECONCILIATION_REQUIRED: copy('Cobrança exige reconciliação', 'Billing reconciliation required'),
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
          'Últimas 100 ações administrativas em usuários, hierarquia e planos, com responsável e valores antes e depois da mudança.',
          'The latest 100 administrative actions across users, hierarchy, and plans, with the actor and values before and after each change.',
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
