export const dynamic = 'force-dynamic'

import Link from 'next/link'
import type { Role } from '@prisma/client'
import { Shell } from '@/components/Shell'
import { ModuleSummary } from '@/components/ModuleSummary'
import { PageHeader } from '@/components/PageHeader'
import {
  buildAdminUserWhere,
  type AdminUserDirectoryFilters,
} from '@/lib/admin/user-management'
import { diffAuditFields } from '@/lib/audit-diff'
import { formatDate, formatNumber } from '@/lib/i18n/format'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'

type Copy = (portuguese: string, english: string) => string

const EMPTY_USER_FILTERS: AdminUserDirectoryFilters = {
  query: '',
  role: null,
  plan: null,
  accessStatus: null,
  subscriptionStatus: null,
  page: 1,
}

function userWhere(
  now: Date,
  filters: Partial<AdminUserDirectoryFilters>,
) {
  return buildAdminUserWhere({ ...EMPTY_USER_FILTERS, ...filters }, now)
}

function roleLabel(role: Role, copy: Copy) {
  if (role === 'ADMIN') return copy('Equipe Keepr One', 'Keepr One staff')
  if (role === 'CLIENT') return copy('Cliente', 'Client')
  return copy('Agente', 'Agent')
}

function auditActionLabel(action: string, copy: Copy) {
  const labels: Record<string, string> = {
    ADMIN_USER_PROFILE_UPDATED: copy('Dados do usuário atualizados', 'User details updated'),
    ADMIN_USER_SUSPENDED: copy('Conta suspensa', 'Account suspended'),
    ADMIN_USER_RESTORED: copy('Acesso restaurado', 'Access restored'),
    ADMIN_PASSWORD_RESET_REQUESTED: copy('Redefinição de senha enviada', 'Password reset sent'),
    ADMIN_EMAIL_VERIFICATION_SENT: copy('Verificação de e-mail enviada', 'Email verification sent'),
    ADMIN_USER_EMAIL_CHANGE_REQUESTED: copy('Troca de e-mail solicitada', 'Email change requested'),
    ADMIN_USER_EMAIL_CHANGE_CURRENT_APPROVED: copy('Troca de e-mail autorizada', 'Email change authorized'),
    ADMIN_USER_EMAIL_CHANGE_COMPLETED: copy('E-mail de acesso alterado', 'Login email changed'),
    ADMIN_USER_EMAIL_CHANGE_DELIVERY_FAILED: copy('Falha ao enviar troca de e-mail', 'Email change delivery failed'),
    ADMIN_USER_SESSIONS_REVOKED: copy('Sessões encerradas', 'Sessions revoked'),
    ADMIN_USER_PREVIEW_STARTED: copy('Visualização de suporte iniciada', 'Support preview started'),
    ADMIN_USER_PREVIEW_ENDED: copy('Visualização de suporte encerrada', 'Support preview ended'),
    ADMIN_USER_PREVIEW_FAILED: copy('Falha ao abrir visualização', 'Support preview failed to start'),
    ADMIN_USER_PREVIEW_STOP_FAILED: copy('Falha ao encerrar visualização', 'Support preview failed to end'),
    ADMIN_USER_PLAN_CHANGED: copy('Plano do usuário alterado', 'User plan changed'),
    ADMIN_USER_PLAN_RECONCILIATION_REQUIRED: copy('Cobrança exige reconciliação', 'Billing reconciliation required'),
    UPDATE_AGENT_HIERARCHY: copy('Hierarquia atualizada', 'Hierarchy updated'),
    UPSERT_COMMISSION_PLAN: copy('Plano de comissão atualizado', 'Commission plan updated'),
  }
  return labels[action] ?? action.replaceAll('_', ' ').toLocaleLowerCase()
}

function CountRow({
  label,
  value,
  detail,
  href,
}: {
  label: string
  value: string
  detail: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-16 items-center justify-between gap-4 border-b border-border-steel py-3 last:border-b-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink group-hover:text-teal">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <strong className="font-mono text-lg font-semibold tabular-nums text-ink">{value}</strong>
        <span aria-hidden className="text-sm text-teal">→</span>
      </span>
    </Link>
  )
}

function AttentionRow({
  label,
  value,
  detail,
  href,
  action,
  tone,
}: {
  label: string
  value: string
  detail: string
  href: string
  action: string
  tone: 'warning' | 'danger' | 'neutral'
}) {
  const toneClass = tone === 'danger'
    ? 'bg-danger-pale text-danger'
    : tone === 'warning'
      ? 'bg-gold-pale text-gold-ink'
      : 'bg-panel text-ink-muted'

  return (
    <li className="grid gap-3 border-b border-border-steel px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`inline-flex min-w-10 shrink-0 justify-center rounded-full px-2.5 py-1 font-mono text-xs font-semibold tabular-nums ${toneClass}`}>
          {value}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{label}</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{detail}</p>
        </div>
      </div>
      <Link href={href} className="ml-[52px] inline-flex min-h-10 w-fit items-center text-xs font-semibold text-teal hover:text-teal-deep sm:ml-0">
        {action} <span aria-hidden className="ml-1.5">→</span>
      </Link>
    </li>
  )
}

export default async function AdminDashboard() {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const now = new Date()

  const [
    userSegments,
    agentPlanUsers,
    agencyPlanUsers,
    legacyUsers,
    planReviewUsers,
    activeSubscriptions,
    trialSubscriptions,
    pastDueSubscriptions,
    canceledSubscriptions,
    expiredSubscriptions,
    recentAccesses,
    recentAdminAudit,
  ] = await Promise.all([
    prisma.user.groupBy({
      by: ['role', 'banned', 'emailVerified'],
      _count: { _all: true },
    }),
    prisma.user.count({ where: userWhere(now, { plan: 'AGENT' }) }),
    prisma.user.count({ where: userWhere(now, { plan: 'AGENCY' }) }),
    prisma.user.count({ where: userWhere(now, { plan: 'LEGACY' }) }),
    prisma.user.count({ where: userWhere(now, { plan: 'NEEDS_REVIEW' }) }),
    prisma.user.count({ where: userWhere(now, { subscriptionStatus: 'ACTIVE' }) }),
    prisma.user.count({ where: userWhere(now, { subscriptionStatus: 'TRIALING' }) }),
    prisma.user.count({ where: userWhere(now, { subscriptionStatus: 'PAST_DUE' }) }),
    prisma.user.count({ where: userWhere(now, { subscriptionStatus: 'CANCELED' }) }),
    prisma.user.count({ where: userWhere(now, { subscriptionStatus: 'EXPIRED' }) }),
    prisma.session.findMany({
      where: { impersonatedBy: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 6,
      select: {
        id: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, role: true, banned: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { user: { is: { role: 'ADMIN' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 6,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        before: true,
        after: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
  ])

  const segmentCount = (predicate: (segment: (typeof userSegments)[number]) => boolean) =>
    userSegments.reduce(
      (total, segment) => total + (predicate(segment) ? segment._count._all : 0),
      0,
    )
  const usersTotal = segmentCount(() => true)
  const usersSuspended = segmentCount((segment) => segment.banned)
  const usersUnverified = segmentCount((segment) => !segment.emailVerified)
  const agentUsers = segmentCount((segment) => segment.role === 'AGENT')
  const clientUsers = segmentCount((segment) => segment.role === 'CLIENT')
  const staffUsers = segmentCount((segment) => segment.role === 'ADMIN')
  const usersWithAccess = usersTotal - usersSuspended
  const number = (value: number) => formatNumber(value, language)
  const auditFieldLabels: Record<string, string> = {
    accessStatus: copy('Acesso', 'Access'),
    agencyName: copy('Agência', 'Agency'),
    clientEmail: copy('E-mail do cliente', 'Client email'),
    clientName: copy('Nome do cliente', 'Client name'),
    delivery: copy('Envio', 'Delivery'),
    language: copy('Idioma', 'Language'),
    name: copy('Nome', 'Name'),
    npn: 'NPN',
    parentAgentId: copy('Gestor', 'Manager'),
    phone: copy('Telefone', 'Phone'),
    rank: copy('Cargo', 'Rank'),
    reason: copy('Motivo', 'Reason'),
    recipient: copy('Destinatário', 'Recipient'),
    timeZone: copy('Fuso horário', 'Time zone'),
    plan: copy('Plano', 'Plan'),
    subscriptionId: copy('Assinatura', 'Subscription'),
    agencyId: copy('Agência', 'Agency'),
    unitAmountCents: copy('Mensalidade (centavos)', 'Monthly price (cents)'),
    currency: copy('Moeda', 'Currency'),
    modules: copy('Módulos', 'Modules'),
    stripePriceId: copy('Preço no Stripe', 'Stripe price'),
    stripeSubscriptionId: copy('Assinatura no Stripe', 'Stripe subscription'),
    reconciliationStatus: copy('Reconciliação', 'Reconciliation'),
  }

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={copy('Backoffice Keepr One', 'Keepr One back office')}
        eyebrow={copy('Gestão da plataforma', 'Platform management')}
        description={copy(
          'Acompanhe contas, planos, assinaturas e pontos de atenção de toda a plataforma em um só lugar.',
          'Monitor accounts, plans, subscriptions, and platform-wide issues in one place.',
        )}
      >
        <Link href="/admin/users" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md bg-teal px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-teal-deep active:translate-y-px">
          {copy('Gerenciar usuários', 'Manage users')} <span aria-hidden>→</span>
        </Link>
      </PageHeader>

      <ModuleSummary
        label={copy('Resumo da plataforma', 'Platform summary')}
        items={[
          {
            label: copy('Usuários', 'Users'),
            value: number(usersTotal),
            detail: copy(`${number(usersWithAccess)} com acesso`, `${number(usersWithAccess)} with access`),
            tone: 'green',
          },
          {
            label: copy('Planos Agente', 'Agent plans'),
            value: number(agentPlanUsers),
            detail: copy('Todos os agentes, individuais ou vinculados', 'All agents, individual or agency-linked'),
          },
          {
            label: copy('Planos Agência', 'Agency plans'),
            value: number(agencyPlanUsers),
            detail: copy('Contas responsáveis por agências', 'Accounts responsible for agencies'),
          },
          {
            label: copy('Assinaturas ativas', 'Active subscriptions'),
            value: number(activeSubscriptions),
            detail: copy(`${number(trialSubscriptions)} em período de teste`, `${number(trialSubscriptions)} in trial`),
            tone: pastDueSubscriptions > 0 ? 'gold' : 'neutral',
          },
        ]}
      />

      <section className="mt-8 overflow-hidden rounded-xl border border-border-steel bg-paper" aria-labelledby="commercial-overview-heading">
        <div className="border-b border-border-steel px-5 py-4 sm:px-6">
          <h2 id="commercial-overview-heading" className="text-base font-semibold text-ink">
            {copy('Base comercial e assinaturas', 'Commercial base and subscriptions')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            {copy(
              'Os números respeitam o plano atual de cada conta e o período vigente da assinatura.',
              'Counts reflect each account’s current plan and active subscription period.',
            )}
          </p>
        </div>
        <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-border-steel">
          <div className="px-5 py-4 sm:px-6">
            <h3 className="text-xs font-semibold uppercase tracking-[0.03em] text-ink-muted">{copy('Planos da base', 'Plan distribution')}</h3>
            <div className="mt-2">
              <CountRow label={copy('Plano Agente', 'Agent plan')} value={number(agentPlanUsers)} detail={copy('Agentes individuais e agentes vinculados a uma agência', 'Individual and agency-linked agents')} href="/admin/users?plan=AGENT" />
              <CountRow label={copy('Plano Agência', 'Agency plan')} value={number(agencyPlanUsers)} detail={copy('Responsáveis com estrutura própria de equipe', 'Owners with their own team structure')} href="/admin/users?plan=AGENCY" />
            </div>
          </div>
          <div className="border-t border-border-steel px-5 py-4 sm:px-6 lg:border-t-0">
            <h3 className="text-xs font-semibold uppercase tracking-[0.03em] text-ink-muted">{copy('Estado das assinaturas', 'Subscription status')}</h3>
            <div className="mt-2">
              <CountRow label={copy('Ativas', 'Active')} value={number(activeSubscriptions)} detail={copy('Cobrança e acesso comercial vigentes', 'Current billing and commercial access')} href="/admin/users?subscription=ACTIVE" />
              <CountRow label={copy('Em período de teste', 'Trial')} value={number(trialSubscriptions)} detail={copy('Contas dentro da janela de avaliação', 'Accounts currently in an evaluation window')} href="/admin/users?subscription=TRIALING" />
              <CountRow label={copy('Pagamento pendente', 'Past due')} value={number(pastDueSubscriptions)} detail={copy('Assinaturas que precisam de acompanhamento', 'Subscriptions requiring follow-up')} href="/admin/users?subscription=PAST_DUE" />
              <CountRow label={copy('Canceladas', 'Canceled')} value={number(canceledSubscriptions)} detail={copy('Assinaturas encerradas antes ou ao fim do período', 'Subscriptions ended before or at the period close')} href="/admin/users?subscription=CANCELED" />
              <CountRow label={copy('Expiradas', 'Expired')} value={number(expiredSubscriptions)} detail={copy('Períodos comerciais que já terminaram', 'Commercial periods that have already ended')} href="/admin/users?subscription=EXPIRED" />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 overflow-hidden rounded-xl border border-border-steel bg-paper" aria-labelledby="attention-heading">
        <div className="flex flex-col gap-2 border-b border-border-steel px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <h2 id="attention-heading" className="text-base font-semibold text-ink">{copy('Precisa de atenção', 'Needs attention')}</h2>
            <p className="mt-1 text-sm text-ink-muted">{copy('Pendências que podem afetar acesso, cobrança ou uso do produto.', 'Issues that may affect access, billing, or product use.')}</p>
          </div>
          <span className="font-mono text-xs text-ink-muted">
            {copy(`${number(usersUnverified + usersSuspended + pastDueSubscriptions + legacyUsers + planReviewUsers)} ocorrências`, `${number(usersUnverified + usersSuspended + pastDueSubscriptions + legacyUsers + planReviewUsers)} issues`)}
          </span>
        </div>
        <ul>
          <AttentionRow label={copy('Contas suspensas', 'Suspended accounts')} value={number(usersSuspended)} detail={copy('Usuários sem permissão para iniciar novas sessões.', 'Users who cannot start new sessions.')} href="/admin/users?access=SUSPENDED" action={copy('Revisar contas', 'Review accounts')} tone={usersSuspended > 0 ? 'danger' : 'neutral'} />
          <AttentionRow label={copy('E-mails não verificados', 'Unverified emails')} value={number(usersUnverified)} detail={copy('Contas que ainda não confirmaram o endereço de acesso.', 'Accounts that have not confirmed their login address.')} href="/admin/users" action={copy('Abrir usuários', 'Open users')} tone={usersUnverified > 0 ? 'warning' : 'neutral'} />
          <AttentionRow label={copy('Pagamentos pendentes', 'Past-due payments')} value={number(pastDueSubscriptions)} detail={copy('Assinaturas com cobrança que exige acompanhamento.', 'Subscriptions with billing that requires follow-up.')} href="/admin/users?subscription=PAST_DUE" action={copy('Ver assinaturas', 'View subscriptions')} tone={pastDueSubscriptions > 0 ? 'danger' : 'neutral'} />
          <AttentionRow label={copy('Contas sem plano definido', 'Accounts without an assigned plan')} value={number(legacyUsers)} detail={copy('Contas anteriores aos planos comerciais atuais.', 'Accounts created before the current commercial plans.')} href="/admin/users?plan=LEGACY" action={copy('Revisar contas', 'Review accounts')} tone={legacyUsers > 0 ? 'warning' : 'neutral'} />
          <AttentionRow label={copy('Planos para revisar', 'Plans to review')} value={number(planReviewUsers)} detail={copy('Contas cujo vínculo comercial precisa ser confirmado.', 'Accounts whose commercial relationship needs confirmation.')} href="/admin/users?plan=NEEDS_REVIEW" action={copy('Revisar planos', 'Review plans')} tone={planReviewUsers > 0 ? 'danger' : 'neutral'} />
        </ul>
      </section>

      <div className="mt-8 grid items-start gap-8 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-border-steel bg-paper" aria-labelledby="recent-access-heading">
          <div className="border-b border-border-steel px-5 py-4 sm:px-6">
            <h2 id="recent-access-heading" className="text-base font-semibold text-ink">{copy('Acessos recentes', 'Recent access')}</h2>
            <p className="mt-1 text-sm text-ink-muted">{copy('Sessões iniciadas mais recentemente na plataforma.', 'Most recently created platform sessions.')}</p>
          </div>
          {recentAccesses.length > 0 ? (
            <ul className="divide-y divide-border-steel px-5 sm:px-6">
              {recentAccesses.map((access) => (
                <li key={access.id} className="flex items-start justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <Link href={`/admin/users/${access.user.id}`} className="truncate text-sm font-semibold text-ink hover:text-teal">
                      {access.user.name}
                    </Link>
                    <p className="mt-1 truncate text-xs text-ink-muted">{access.user.email}</p>
                    <p className="mt-1 text-xs font-medium text-ink-muted">
                      {roleLabel(access.user.role, copy)} · {access.user.banned ? copy('suspenso', 'suspended') : copy('acesso ativo', 'active access')}
                    </p>
                  </div>
                  <time className="shrink-0 font-mono text-xs text-ink-muted" dateTime={access.createdAt.toISOString()}>
                    {formatDate(access.createdAt, language, { dateStyle: 'short', timeStyle: 'short' })}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-10 text-sm text-ink-muted sm:px-6">{copy('Nenhum acesso registrado ainda.', 'No access has been recorded yet.')}</p>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-border-steel bg-paper" aria-labelledby="recent-admin-activity-heading">
          <div className="border-b border-border-steel px-5 py-4 sm:px-6">
            <div>
              <h2 id="recent-admin-activity-heading" className="text-base font-semibold text-ink">{copy('Atividade administrativa', 'Administrative activity')}</h2>
              <p className="mt-1 text-sm text-ink-muted">{copy('Últimas ações executadas pela equipe Keepr One.', 'Latest actions performed by Keepr One staff.')}</p>
            </div>
          </div>
          {recentAdminAudit.length > 0 ? (
            <ol className="divide-y divide-border-steel px-5 sm:px-6">
              {recentAdminAudit.map((log) => {
                const firstDiff = diffAuditFields(log.before, log.after)[0]
                const detail = firstDiff
                  ? `${auditFieldLabels[firstDiff.field] ?? firstDiff.field}: ${firstDiff.before} → ${firstDiff.after}`
                  : copy(`Registro em ${log.entity}`, `${log.entity} record`)
                const content = (
                  <>
                    <p className="text-sm font-semibold text-ink">{auditActionLabel(log.action, copy)}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{log.user.name} · {detail}</p>
                  </>
                )

                return (
                  <li key={log.id} className="flex items-start justify-between gap-4 py-4">
                    <div className="min-w-0">
                      {log.entity === 'User' ? (
                        <Link href={`/admin/users/${log.entityId}`} className="group block hover:[&_p:first-child]:text-teal">
                          {content}
                        </Link>
                      ) : content}
                    </div>
                    <time className="shrink-0 font-mono text-xs text-ink-muted" dateTime={log.createdAt.toISOString()}>
                      {formatDate(log.createdAt, language, { dateStyle: 'short', timeStyle: 'short' })}
                    </time>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="px-5 py-10 text-sm text-ink-muted sm:px-6">{copy('Nenhuma ação administrativa registrada.', 'No administrative activity has been recorded.')}</p>
          )}
        </section>
      </div>

      <p className="mt-6 text-xs leading-5 text-ink-muted">
        {copy(
          `A base atual contém ${number(agentUsers)} agentes, ${number(clientUsers)} clientes e ${number(staffUsers)} integrantes da equipe Keepr One.`,
          `The current base contains ${number(agentUsers)} agents, ${number(clientUsers)} clients, and ${number(staffUsers)} Keepr One staff members.`,
        )}
      </p>
    </Shell>
  )
}
