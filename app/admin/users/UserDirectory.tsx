import Link from 'next/link'
import { Avatar } from '@/components/Avatar'
import { formatCurrency, formatDate, formatNumber } from '@/lib/i18n/format'
import type { UserLanguage } from '@/lib/i18n/config'
import type {
  AdminManagedUser,
  AdminUserDirectoryFilters,
  AdminUserPlan,
} from '@/lib/admin/user-management'

type Copy = (portuguese: string, english: string) => string

function roleLabel(role: AdminManagedUser['role'], copy: Copy) {
  if (role === 'ADMIN') return copy('Administrador', 'Administrator')
  if (role === 'CLIENT') return copy('Cliente', 'Client')
  return copy('Agente', 'Agent')
}

function planLabel(plan: AdminUserPlan, copy: Copy) {
  const labels: Record<AdminUserPlan, string> = {
    AGENT_INDIVIDUAL: copy('Plano Agente', 'Agent plan'),
    AGENCY: copy('Plano Agência', 'Agency plan'),
    AGENT_AGENCY_MEMBER: copy('Plano Agente', 'Agent plan'),
    LEGACY: copy('Sem plano definido', 'No plan assigned'),
    NEEDS_REVIEW: copy('Revisão necessária', 'Review required'),
    NOT_APPLICABLE: copy('Sem plano', 'No plan'),
  }
  return labels[plan]
}

function subscriptionLabel(status: string | null, copy: Copy) {
  if (!status) return copy('Sem assinatura', 'No subscription')
  const labels: Record<string, string> = {
    TRIALING: copy('Período de teste', 'Trial'),
    ACTIVE: copy('Ativa', 'Active'),
    PAST_DUE: copy('Pagamento pendente', 'Past due'),
    CANCELED: copy('Cancelada', 'Canceled'),
    EXPIRED: copy('Expirada', 'Expired'),
  }
  return labels[status] ?? status
}

function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  children: React.ReactNode
}) {
  const classes = {
    neutral: 'bg-panel text-ink-muted',
    success: 'bg-success-pale text-success',
    warning: 'bg-gold-pale text-gold-ink',
    danger: 'bg-danger-pale text-danger',
  }
  const dot = {
    neutral: 'bg-ink-muted',
    success: 'bg-success',
    warning: 'bg-gold-ink',
    danger: 'bg-danger',
  }
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${classes[tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
      {children}
    </span>
  )
}

function subscriptionTone(status: string | null) {
  if (status === 'ACTIVE' || status === 'TRIALING') return 'success' as const
  if (status === 'PAST_DUE') return 'warning' as const
  if (status === 'CANCELED' || status === 'EXPIRED') return 'danger' as const
  return 'neutral' as const
}

function UserIdentity({ user, copy }: { user: AdminManagedUser; copy: Copy }) {
  return (
    <div className="flex min-w-[220px] items-center gap-3">
      <Avatar name={user.name} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">{user.email}</p>
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-ink-muted">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${user.emailVerified ? 'bg-success' : 'bg-gold-ink'}`} />
          {user.emailVerified ? copy('E-mail verificado', 'Email verified') : copy('Verificação pendente', 'Verification pending')}
        </span>
      </div>
    </div>
  )
}

function UserAccess({ user, copy }: { user: AdminManagedUser; copy: Copy }) {
  const product = user.productAccess.status
  const productLabel = product === 'TRIAL'
    ? copy('Em teste', 'Trial')
    : product === 'PAYMENT_REQUIRED'
      ? copy('Pagamento necessário', 'Payment required')
      : product === 'ACTIVE'
        ? copy('Produto liberado', 'Product enabled')
        : product === 'LEGACY'
          ? copy('Acesso legado', 'Legacy access')
          : copy('Sem produto', 'No product')
  const productTone = product === 'ACTIVE' || product === 'TRIAL' || product === 'LEGACY'
    ? 'success'
    : product === 'PAYMENT_REQUIRED'
      ? 'warning'
      : 'neutral'

  return (
    <div className="flex flex-col items-start gap-1.5">
      {user.accessStatus === 'ACTIVE' ? (
        <Pill tone="success">{copy('Login ativo', 'Sign-in active')}</Pill>
      ) : (
        <Pill tone="danger">{copy('Login suspenso', 'Sign-in suspended')}</Pill>
      )}
      <Pill tone={productTone}>{productLabel}</Pill>
    </div>
  )
}

function UserPlan({ user, copy, language }: { user: AdminManagedUser; copy: Copy; language: UserLanguage }) {
  return (
    <div className="min-w-[165px]">
      <p className={`text-sm font-semibold ${user.plan === 'NEEDS_REVIEW' ? 'text-danger' : 'text-ink'}`}>
        {planLabel(user.plan, copy)}
      </p>
      <div className="mt-1.5">
        <Pill tone={subscriptionTone(user.subscription?.status ?? null)}>
          {subscriptionLabel(user.subscription?.status ?? null, copy)}
        </Pill>
      </div>
      {user.subscription ? (
        <p className="mt-1.5 font-mono text-xs text-ink-muted">
          {formatCurrency(user.subscription.unitAmountCents / 100, language, user.subscription.currency, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          /{copy('mês', 'month')}
        </p>
      ) : null}
    </div>
  )
}

function buildPageHref(filters: AdminUserDirectoryFilters, page: number) {
  const params = new URLSearchParams()
  if (filters.query) params.set('q', filters.query)
  if (filters.role) params.set('role', filters.role)
  if (filters.plan) params.set('plan', filters.plan)
  if (filters.accessStatus) params.set('access', filters.accessStatus)
  if (filters.subscriptionStatus) params.set('subscription', filters.subscriptionStatus)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/admin/users?${query}` : '/admin/users'
}

export function UserDirectory({
  rows,
  total,
  page,
  pageCount,
  filters,
  language,
  copy,
}: {
  rows: AdminManagedUser[]
  total: number
  page: number
  pageCount: number
  filters: AdminUserDirectoryFilters
  language: UserLanguage
  copy: Copy
}) {
  const resultStart = total === 0 ? 0 : (page - 1) * 15 + 1
  const resultEnd = Math.min(page * 15, total)

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border-steel bg-paper" aria-labelledby="user-directory-title">
      <div className="flex flex-col gap-2 border-b border-border-steel px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="user-directory-title" className="text-base font-semibold tracking-[-0.02em] text-ink">
            {copy('Diretório de usuários', 'User directory')}
          </h2>
          <p className="mt-1 text-xs text-ink-muted" role="status" aria-live="polite">
            {total === 0
              ? copy('Nenhum usuário encontrado.', 'No users found.')
              : copy(
                  `${formatNumber(resultStart, language)}–${formatNumber(resultEnd, language)} de ${formatNumber(total, language)} usuários`,
                  `${formatNumber(resultStart, language)}–${formatNumber(resultEnd, language)} of ${formatNumber(total, language)} users`,
                )}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-base font-semibold text-ink">{copy('Nenhum perfil corresponde aos filtros.', 'No profiles match these filters.')}</p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-ink-muted">
            {copy('Remova um ou mais filtros para ampliar a consulta.', 'Remove one or more filters to broaden the search.')}
          </p>
          <Link href="/admin/users" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-border-steel px-4 py-2 text-sm font-semibold text-ink hover:border-teal hover:bg-panel">
            {copy('Limpar filtros', 'Clear filters')}
          </Link>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto xl:block" role="region" aria-label={copy('Lista de usuários', 'User list')} tabIndex={0}>
            <table className="w-full border-collapse">
              <thead className="bg-panel/70">
                <tr>
                  <th className="module-table-heading text-left">{copy('Usuário', 'User')}</th>
                  <th className="module-table-heading text-left">{copy('Tipo e acesso', 'Type and access')}</th>
                  <th className="module-table-heading text-left">{copy('Plano e assinatura', 'Plan and subscription')}</th>
                  <th className="module-table-heading text-left">{copy('Organização', 'Organization')}</th>
                  <th className="module-table-heading text-left">{copy('Último acesso', 'Last seen')}</th>
                  <th className="module-table-heading"><span className="sr-only">{copy('Ações', 'Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <tr key={user.id} className="module-table-row">
                    <td className="module-table-cell"><UserIdentity user={user} copy={copy} /></td>
                    <td className="module-table-cell align-top">
                      <p className="mb-2 text-sm font-medium text-ink">{roleLabel(user.role, copy)}</p>
                      <UserAccess user={user} copy={copy} />
                    </td>
                    <td className="module-table-cell align-top"><UserPlan user={user} copy={copy} language={language} /></td>
                    <td className="module-table-cell align-top">
                      <p className="max-w-[190px] truncate text-sm font-medium text-ink">
                        {user.agency?.name ?? user.client?.assignedAgent.name ?? copy('Conta individual', 'Individual account')}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {user.agency
                          ? user.agency.membershipRole === 'OWNER' ? copy('Responsável', 'Owner') : copy('Membro', 'Member')
                          : user.agent?.parentAgent?.name ?? copy('Sem vínculo de agência', 'No agency link')}
                      </p>
                    </td>
                    <td className="module-table-cell align-top">
                      <p className="whitespace-nowrap font-mono text-xs text-ink">
                        {user.lastSeenAt
                          ? formatDate(user.lastSeenAt, language, { dateStyle: 'short', timeStyle: 'short' })
                          : copy('Nunca', 'Never')}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {copy(`${user.sessionCount} sessões`, `${user.sessionCount} sessions`)}
                      </p>
                    </td>
                    <td className="module-table-cell text-right align-top">
                      <Link href={`/admin/users/${user.id}`} className="inline-flex min-h-10 items-center rounded-full border border-border-steel px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-teal hover:bg-panel">
                        {copy('Abrir conta', 'Open account')} <span aria-hidden className="ml-1.5">→</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-border-steel xl:hidden">
            {rows.map((user) => (
              <article key={user.id} className="p-4 sm:p-5">
                <UserIdentity user={user} copy={copy} />
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border-steel py-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.03em] text-ink-muted">{copy('Tipo', 'Type')}</p>
                    <p className="mt-1 text-sm font-medium text-ink">{roleLabel(user.role, copy)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.03em] text-ink-muted">{copy('Acesso', 'Access')}</p>
                    <div className="mt-1"><UserAccess user={user} copy={copy} /></div>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.03em] text-ink-muted">{copy('Plano', 'Plan')}</p>
                    <div className="mt-1"><UserPlan user={user} copy={copy} language={language} /></div>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.03em] text-ink-muted">{copy('Organização', 'Organization')}</p>
                    <p className="mt-1 truncate text-sm font-medium text-ink">{user.agency?.name ?? copy('Conta individual', 'Individual account')}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-4">
                  <p className="text-xs text-ink-muted">
                    {user.lastSeenAt
                      ? copy('Visto em ', 'Seen on ') + formatDate(user.lastSeenAt, language, { dateStyle: 'short' })
                      : copy('Nenhum acesso registrado', 'No sign-in recorded')}
                  </p>
                  <Link href={`/admin/users/${user.id}`} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-rail-strong px-4 py-2 text-xs font-semibold text-paper">
                    {copy('Abrir conta', 'Open account')} →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {rows.length > 0 && pageCount > 1 ? (
        <nav aria-label={copy('Paginação de usuários', 'User pagination')} className="grid grid-cols-2 items-center gap-3 border-t border-border-steel px-4 py-4 sm:grid-cols-[1fr_auto_1fr] sm:px-5">
          {page > 1 ? (
            <Link href={buildPageHref(filters, page - 1)} className="inline-flex min-h-11 items-center rounded-full border border-border-steel px-4 py-2 text-sm font-semibold text-ink hover:border-teal hover:bg-panel">
              ← {copy('Anterior', 'Previous')}
            </Link>
          ) : <span />}
          <span className="order-first col-span-2 text-center font-mono text-xs text-ink-muted sm:order-none sm:col-span-1">{copy(`Página ${page} de ${pageCount}`, `Page ${page} of ${pageCount}`)}</span>
          {page < pageCount ? (
            <Link href={buildPageHref(filters, page + 1)} className="inline-flex min-h-11 items-center justify-self-end rounded-full border border-border-steel px-4 py-2 text-sm font-semibold text-ink hover:border-teal hover:bg-panel">
              {copy('Próxima', 'Next')} →
            </Link>
          ) : <span />}
        </nav>
      ) : null}
    </section>
  )
}

export function UserFilters({ filters, copy }: { filters: AdminUserDirectoryFilters; copy: Copy }) {
  const selectClass = 'min-h-11 min-w-0 rounded-lg border border-border-steel bg-paper px-3 py-2.5 text-sm text-ink outline-none focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale'
  return (
    <form method="get" className="mt-6 rounded-xl border border-border-steel bg-paper p-4 sm:p-5" aria-label={copy('Filtros de usuários', 'User filters')}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
        <label className="flex min-w-0 flex-col gap-2 sm:col-span-2 xl:col-span-4">
          <span className="text-xs font-semibold text-ink">{copy('Buscar usuário', 'Search users')}</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.query}
            placeholder={copy('Nome, e-mail, NPN, telefone ou agência', 'Name, email, NPN, phone, or agency')}
            className="min-h-11 w-full rounded-lg border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale"
          />
        </label>
        <div className="contents">
          <label className="flex min-w-0 flex-col gap-2 xl:col-span-2">
            <span className="text-xs font-semibold text-ink">{copy('Tipo de usuário', 'User type')}</span>
            <select name="role" defaultValue={filters.role ?? ''} className={selectClass}>
              <option value="">{copy('Todos', 'All')}</option>
              <option value="ADMIN">{copy('Administrador', 'Administrator')}</option>
              <option value="AGENT">{copy('Agente', 'Agent')}</option>
              <option value="CLIENT">{copy('Cliente', 'Client')}</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-2 xl:col-span-2">
            <span className="text-xs font-semibold text-ink">{copy('Plano', 'Plan')}</span>
            <select name="plan" defaultValue={filters.plan ?? ''} className={selectClass}>
              <option value="">{copy('Todos', 'All')}</option>
              <option value="AGENT">{copy('Plano Agente', 'Agent plan')}</option>
              <option value="AGENCY">{copy('Plano Agência', 'Agency plan')}</option>
              {filters.plan === 'LEGACY' ? <option value="LEGACY">{copy('Sem plano definido', 'No plan assigned')}</option> : null}
              {filters.plan === 'NEEDS_REVIEW' ? <option value="NEEDS_REVIEW">{copy('Revisão necessária', 'Review required')}</option> : null}
              {filters.plan === 'NOT_APPLICABLE' ? <option value="NOT_APPLICABLE">{copy('Sem plano', 'No plan')}</option> : null}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-2 xl:col-span-2">
            <span className="text-xs font-semibold text-ink">{copy('Acesso', 'Access')}</span>
            <select name="access" defaultValue={filters.accessStatus ?? ''} className={selectClass}>
              <option value="">{copy('Todos', 'All')}</option>
              <option value="ACTIVE">{copy('Ativo', 'Active')}</option>
              <option value="SUSPENDED">{copy('Suspenso', 'Suspended')}</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-2 xl:col-span-2">
            <span className="text-xs font-semibold text-ink">{copy('Assinatura', 'Subscription')}</span>
            <select name="subscription" defaultValue={filters.subscriptionStatus ?? ''} className={selectClass}>
              <option value="">{copy('Todas', 'All')}</option>
              <option value="TRIALING">{copy('Em teste', 'Trial')}</option>
              <option value="ACTIVE">{copy('Ativa', 'Active')}</option>
              <option value="PAST_DUE">{copy('Pagamento pendente', 'Past due')}</option>
              <option value="CANCELED">{copy('Cancelada', 'Canceled')}</option>
              <option value="EXPIRED">{copy('Expirada', 'Expired')}</option>
              <option value="NO_SUBSCRIPTION">{copy('Sem assinatura', 'No subscription')}</option>
            </select>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-span-2 xl:col-span-12">
          <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-full bg-rail-strong px-5 py-2.5 text-sm font-semibold text-paper hover:bg-rail">
            {copy('Aplicar filtros', 'Apply filters')}
          </button>
          <Link href="/admin/users" className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-steel px-4 py-2.5 text-sm font-semibold text-ink hover:border-teal hover:bg-panel">
            {copy('Limpar', 'Clear')}
          </Link>
        </div>
      </div>
    </form>
  )
}
