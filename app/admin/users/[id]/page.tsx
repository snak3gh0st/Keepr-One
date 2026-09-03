import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Avatar } from '@/components/Avatar'
import { ModuleSummary } from '@/components/ModuleSummary'
import { PageHeader } from '@/components/PageHeader'
import { Shell } from '@/components/Shell'
import { readAdminManagedUser, type AdminUserPlan } from '@/lib/admin/user-management'
import { formatCurrency, formatDate, formatNumber } from '@/lib/i18n/format'
import { getServerI18n } from '@/lib/i18n/server'
import { requireRole } from '@/lib/require-role'
import {
  ManagedUserPreviewControl,
  ManagedUserProfileForm,
  ManagedUserSecurityControls,
} from './ManagedUserForms'
import { ManagedUserPlanForm } from './ManagedUserPlanForm'
import { ManagedUserProductAccessForm } from './ManagedUserProductAccessForm'

export const dynamic = 'force-dynamic'

type Copy = (portuguese: string, english: string) => string

function roleLabel(role: 'ADMIN' | 'AGENT' | 'CLIENT', copy: Copy) {
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

function accessLabel(status: 'ACTIVE' | 'SUSPENDED', copy: Copy) {
  return status === 'ACTIVE' ? copy('Ativo', 'Active') : copy('Suspenso', 'Suspended')
}

function productAccessLabel(
  status: 'ACTIVE' | 'TRIAL' | 'PAYMENT_REQUIRED' | 'LEGACY' | 'NOT_APPLICABLE',
  copy: Copy,
) {
  if (status === 'ACTIVE') return copy('Liberado', 'Enabled')
  if (status === 'TRIAL') return copy('Em teste', 'Trial')
  if (status === 'PAYMENT_REQUIRED') return copy('Pagamento', 'Payment')
  if (status === 'LEGACY') return copy('Legado', 'Legacy')
  return copy('Não aplicável', 'Not applicable')
}

function StatusMark({
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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${classes[tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
      {children}
    </span>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <div className="mb-6 border-b border-border-steel pb-5">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-teal">{eyebrow}</p>
      <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-ink">{title}</h2>
      {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{description}</p> : null}
    </div>
  )
}

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-border-steel py-3 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-5">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className={`${mono ? 'font-mono text-xs' : 'text-sm'} min-w-0 text-ink`}>{value}</dd>
    </div>
  )
}

function maskIp(ip: string | null, copy: Copy) {
  if (!ip) return copy('Não informado', 'Not reported')
  if (ip.includes('.')) {
    const parts = ip.split('.')
    return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.*` : copy('Protegido', 'Protected')
  }
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:…`
  return copy('Protegido', 'Protected')
}

function deviceName(userAgent: string | null, copy: Copy) {
  if (!userAgent) return copy('Dispositivo não identificado', 'Unknown device')
  const browser = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('Chrome/')
      ? 'Chrome'
      : userAgent.includes('Firefox/')
        ? 'Firefox'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : copy('Navegador', 'Browser')
  const system = userAgent.includes('Mac OS')
    ? 'macOS'
    : userAgent.includes('Windows')
      ? 'Windows'
      : userAgent.includes('Android')
        ? 'Android'
        : userAgent.includes('iPhone') || userAgent.includes('iPad')
          ? 'iOS'
          : copy('Sistema não identificado', 'Unknown system')
  return `${browser} · ${system}`
}

function actionLabel(action: string, copy: Copy) {
  const labels: Record<string, string> = {
    ADMIN_USER_PROFILE_UPDATED: copy('Perfil atualizado', 'Profile updated'),
    ADMIN_USER_SUSPENDED: copy('Conta suspensa', 'Account suspended'),
    ADMIN_USER_RESTORED: copy('Acesso restaurado', 'Access restored'),
    ADMIN_PASSWORD_RESET_REQUESTED: copy('Redefinição de senha enviada', 'Password reset sent'),
    ADMIN_EMAIL_VERIFICATION_SENT: copy('Verificação de e-mail enviada', 'Email verification sent'),
    ADMIN_USER_EMAIL_CHANGE_REQUESTED: copy('Troca de e-mail solicitada', 'Email change requested'),
    ADMIN_USER_EMAIL_CHANGE_CURRENT_APPROVED: copy('E-mail atual autorizou a troca', 'Current email authorized the change'),
    ADMIN_USER_EMAIL_CHANGE_COMPLETED: copy('Troca de e-mail concluída', 'Email change completed'),
    ADMIN_USER_EMAIL_CHANGE_DELIVERY_FAILED: copy('Falha no envio da troca de e-mail', 'Email change delivery failed'),
    ADMIN_USER_SESSIONS_REVOKED: copy('Sessões encerradas', 'Sessions revoked'),
    ADMIN_USER_PREVIEW_STARTED: copy('Visualização de suporte iniciada', 'Support preview started'),
    ADMIN_USER_PREVIEW_ENDED: copy('Visualização de suporte encerrada', 'Support preview ended'),
    ADMIN_USER_PREVIEW_FAILED: copy('Falha ao iniciar visualização', 'Preview failed to start'),
    ADMIN_USER_PREVIEW_STOP_FAILED: copy('Falha ao encerrar visualização', 'Preview failed to end'),
    ADMIN_USER_CREATED: copy('Usuário cadastrado', 'User created'),
    ADMIN_USER_MODULES_UPDATED: copy('Módulos atualizados', 'Modules updated'),
    ADMIN_USER_TRIAL_UPDATED: copy('Período de teste atualizado', 'Trial updated'),
    ADMIN_USER_PAYMENT_REQUIRED: copy('Pagamento exigido', 'Payment required'),
    ADMIN_USER_PLAN_CHANGED: copy('Plano alterado', 'Plan changed'),
    UPDATE_AGENT_HIERARCHY: copy('Hierarquia atualizada', 'Hierarchy updated'),
  }
  return labels[action] ?? action.replaceAll('_', ' ').toLocaleLowerCase()
}

function integrationStatusTone(status: string) {
  if (['CONNECTED', 'ACTIVE', 'READY'].includes(status)) return 'success' as const
  if (['ERROR', 'FAILED', 'DISCONNECTED'].includes(status)) return 'danger' as const
  if (['PENDING', 'CONNECTING', 'DEGRADED', 'RECONNECT_REQUIRED', 'WAITING_FOR_USER', 'PROVISIONING'].includes(status)) return 'warning' as const
  return 'neutral' as const
}

function operationalStatusLabel(status: string, copy: Copy) {
  const labels: Record<string, string> = {
    ACTIVE: copy('Ativo', 'Active'),
    INACTIVE: copy('Inativo', 'Inactive'),
    CONNECTED: copy('Conectado', 'Connected'),
    DISCONNECTED: copy('Desconectado', 'Disconnected'),
    RECONNECT_REQUIRED: copy('Reconexão necessária', 'Reconnect required'),
    ERROR: copy('Erro', 'Error'),
    FAILED: copy('Falhou', 'Failed'),
    PENDING: copy('Pendente', 'Pending'),
    CONNECTING: copy('Conectando', 'Connecting'),
    PROVISIONING: copy('Configurando', 'Provisioning'),
    WAITING_FOR_USER: copy('Aguardando usuário', 'Waiting for user'),
    DEGRADED: copy('Atenção', 'Degraded'),
    CONFIRMED: copy('Confirmado', 'Confirmed'),
    CANCELLED: copy('Cancelado', 'Cancelled'),
    IN_PROGRESS: copy('Em andamento', 'In progress'),
    COMPLETED: copy('Concluído', 'Completed'),
    WELCOME: copy('Boas-vindas', 'Welcome'),
    PROFILE: copy('Perfil', 'Profile'),
    NATIONAL_LIFE: 'National Life',
    CALENDAR: copy('Agenda', 'Calendar'),
    WHATSAPP: 'WhatsApp',
    MODULES: copy('Módulos', 'Modules'),
    REVIEW: copy('Revisão', 'Review'),
  }
  return labels[status] ?? status.replaceAll('_', ' ').toLocaleLowerCase()
}

export default async function AdminManagedUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string; email?: string }>
}) {
  const session = await requireRole('ADMIN')
  const { id } = await params
  const notice = await searchParams
  const { copy, language } = await getServerI18n()
  const user = await readAdminManagedUser(id)
  if (!user) notFound()

  const subscriptionTone = user.subscription?.status === 'ACTIVE' || user.subscription?.status === 'TRIALING'
    ? 'success'
    : user.subscription?.status === 'PAST_DUE'
      ? 'warning'
      : user.subscription
        ? 'danger'
        : 'neutral'
  const plan = planLabel(user.plan, copy)
  const subscription = subscriptionLabel(user.subscription?.status ?? null, copy)
  const isCurrentUser = user.id === session.user.id

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={user.name}
        eyebrow={`${copy('Usuários Keepr One', 'Keepr One users')} · ${roleLabel(user.role, copy)}`}
        description={
          <span>
            {user.email}<br />
            <span className="text-paper/55">
              {copy('Conta criada em', 'Account created on')} {formatDate(user.createdAt, language, { dateStyle: 'long' })}
            </span>
          </span>
        }
      >
        <Link
          href="/admin/users"
          className="inline-flex min-h-11 items-center rounded-full border border-white/25 px-4 py-2 text-sm font-semibold text-paper transition-colors hover:border-white/60 hover:bg-white/10"
        >
          <span aria-hidden className="mr-2">←</span>
          {copy('Voltar aos usuários', 'Back to users')}
        </Link>
      </PageHeader>

      {notice.created === '1' ? (
        <div
          role="status"
          className={`mt-6 rounded-xl border px-4 py-3 text-sm ${notice.email === 'failed' ? 'border-gold/30 bg-gold-pale text-gold-ink' : 'border-success/20 bg-success-pale text-success'}`}
        >
          {notice.email === 'failed'
            ? copy(
                'Usuário criado, mas o e-mail de primeiro acesso não foi entregue. Reenvie a redefinição de senha nos controles de segurança.',
                'User created, but the first-access email was not delivered. Resend the password reset from the security controls.',
              )
            : notice.email === 'skipped'
              ? copy(
                  'Usuário criado. O e-mail de primeiro acesso não foi enviado.',
                  'User created. The first-access email was not sent.',
                )
              : copy(
                  `Usuário criado e acesso enviado para ${user.email}.`,
                  `User created and access sent to ${user.email}.`,
                )}
        </div>
      ) : null}

      <ModuleSummary
        label={copy('Resumo da conta', 'Account summary')}
        items={[
          {
            label: copy('Login', 'Sign-in'),
            value: accessLabel(user.accessStatus, copy),
            detail: user.accessStatus === 'ACTIVE'
              ? copy('Login permitido', 'Sign-in allowed')
              : copy('Login e sessões bloqueados', 'Sign-in and sessions blocked'),
            tone: user.accessStatus === 'ACTIVE' ? 'green' : 'danger',
            compact: true,
          },
          {
            label: copy('Plano', 'Plan'),
            value: plan,
            detail: user.agency?.name ?? copy('Conta sem vínculo de agência', 'No agency relationship'),
            tone: user.plan === 'NEEDS_REVIEW' ? 'danger' : 'neutral',
            compact: true,
          },
          {
            label: copy('Produto', 'Product'),
            value: productAccessLabel(user.productAccess.status, copy),
            detail: user.productAccess.status === 'TRIAL' && user.subscription?.currentPeriodEnd
              ? `${copy('Até', 'Until')} ${formatDate(user.subscription.currentPeriodEnd, language, { dateStyle: 'medium' })}`
              : subscription,
            tone: user.productAccess.status === 'PAYMENT_REQUIRED'
              ? 'gold'
              : user.productAccess.status === 'NOT_APPLICABLE'
                ? 'neutral'
                : 'green',
            compact: true,
          },
          {
            label: copy('Módulos', 'Modules'),
            value: user.productAccess.enabledModules
              ? `${formatNumber(user.productAccess.enabledModules.length, language)} / 11`
              : copy('Todos', 'All'),
            detail: user.productAccess.managed
              ? copy('Acesso personalizado', 'Custom access')
              : copy('Sem restrição administrativa', 'No administrative restriction'),
            compact: true,
          },
        ]}
      />

      <div className="mt-6 grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border-steel bg-paper p-5 sm:p-6" aria-labelledby="profile-heading">
            <SectionHeading
              eyebrow={copy('Cadastro', 'Profile')}
              title={copy('Dados do usuário', 'User details')}
              description={copy(
                'Edite os dados operacionais desta conta. Identidade, segurança, cobrança e organização continuam protegidas por fluxos próprios.',
                'Edit this account’s operational details. Identity, security, billing, and organization remain protected by dedicated workflows.',
              )}
            />
            <div id="profile-heading" className="sr-only">{copy('Dados do usuário', 'User details')}</div>
            <ManagedUserProfileForm
              values={{
                id: user.id,
                updatedAt: user.updatedAt.toISOString(),
                agentUpdatedAt: user.agent?.updatedAt.toISOString() ?? null,
                agencyUpdatedAt: user.ownsActiveAgency
                  ? user.agency?.updatedAt.toISOString() ?? null
                  : null,
                clientUpdatedAt: user.client?.updatedAt.toISOString() ?? null,
                name: user.name,
                email: user.email,
                language: user.language,
                timeZone: user.timeZone,
                phone: user.agent?.phone ?? null,
                npn: user.agent?.npn ?? null,
                rank: user.agent?.rank ?? null,
                agencyName: user.ownsActiveAgency ? user.agency?.name ?? null : null,
                clientName: user.client?.name ?? null,
                clientEmail: user.client?.email ?? null,
                clientPhone: user.client?.phone ?? null,
                isAgent: Boolean(user.agent),
                isClient: Boolean(user.client),
                ownsAgency: user.ownsActiveAgency,
              }}
            />
          </section>

          {user.productAccess.managed
            && user.productAccess.updatedAt
            && user.productAccess.enabledModules
            && user.subscription
            && (user.plan === 'AGENT_INDIVIDUAL' || user.plan === 'AGENCY' || user.plan === 'AGENT_AGENCY_MEMBER') ? (
            <section className="rounded-xl border border-border-steel bg-paper p-5 sm:p-6" aria-labelledby="product-access-heading">
              <SectionHeading
                eyebrow={copy('Controle de produto', 'Product control')}
                title={copy('Acesso ao produto', 'Product access')}
                description={copy(
                  'Altere o plano e controle os módulos, o período de teste e a exigência de pagamento desta conta.',
                  'Change the plan and manage this account’s modules, trial period, and payment requirement.',
                )}
              />
              <div id="product-access-heading" className="sr-only">{copy('Acesso ao produto', 'Product access')}</div>
              <div className="space-y-7">
                <ManagedUserPlanForm
                  userId={user.id}
                  expectedUpdatedAt={user.productAccess.updatedAt.toISOString()}
                  currentPlan={user.plan}
                  currentAgencyName={user.agency?.name ?? null}
                  stripeCustomerLinked={user.subscription.stripeCustomerLinked}
                  stripeSubscriptionLinked={user.subscription.stripeSubscriptionLinked}
                  blockers={{
                    // The agency count includes its OWNER. Only additional
                    // members prevent ending an otherwise empty agency.
                    activeMemberCount: Math.max(0, (user.agency?.activeMemberCount ?? 0) - 1),
                    childAgencyCount: user.agency?.childAgencyCount ?? 0,
                    pendingInvitationCount: user.agency?.pendingInvitationCount ?? 0,
                    hasParentAgency: Boolean(user.agency?.parentAgency),
                    subAgentCount: user.agent?.counts.subAgents ?? 0,
                    hasParentAgent: Boolean(user.agent?.parentAgent),
                  }}
                />
                <ManagedUserProductAccessForm
                  userId={user.id}
                  expectedUpdatedAt={user.productAccess.updatedAt.toISOString()}
                  plan={user.plan}
                  status={user.productAccess.status === 'LEGACY' || user.productAccess.status === 'NOT_APPLICABLE'
                    ? 'PAYMENT_REQUIRED'
                    : user.productAccess.status}
                  modules={user.productAccess.enabledModules}
                  paymentReason={user.productAccess.paymentReason}
                  currentPeriodEnd={user.subscription.currentPeriodEnd?.toISOString() ?? null}
                  providerManaged={user.subscription.providerManaged}
                />
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-border-steel bg-paper p-5 sm:p-6">
            <SectionHeading
              eyebrow={copy('Estrutura e cobrança', 'Structure and billing')}
              title={copy('Plano, agência e operação', 'Plan, agency, and operations')}
              description={copy(
                'O painel lê a estrutura real da conta e o estado sincronizado da assinatura. A mudança de plano atualiza o acesso e, quando houver assinatura ativa, também o preço no Stripe.',
                'The panel reads the account structure and synchronized subscription state. Plan changes update access and, when an active subscription exists, its Stripe price as well.',
              )}
            />
            <div className="grid gap-7 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">{copy('Conta comercial', 'Commercial account')}</h3>
                <dl className="mt-3">
                  <DetailRow label={copy('Tipo de usuário', 'User type')} value={roleLabel(user.role, copy)} />
                  <DetailRow label={copy('Plano atual', 'Current plan')} value={plan} />
                  <DetailRow
                    label={copy('Assinatura', 'Subscription')}
                    value={<StatusMark tone={subscriptionTone}>{subscription}</StatusMark>}
                  />
                  {user.subscription && user.subscription.rawStatus !== user.subscription.status ? (
                    <DetailRow
                      label={copy('Estado no provedor', 'Provider state')}
                      value={operationalStatusLabel(user.subscription.rawStatus, copy)}
                    />
                  ) : null}
                  <DetailRow
                    label={copy('Mensalidade', 'Monthly price')}
                    value={user.subscription
                      ? formatCurrency(user.subscription.unitAmountCents / 100, language, user.subscription.currency, { minimumFractionDigits: 2 })
                      : '—'}
                    mono
                  />
                  <DetailRow
                    label={copy('Período atual', 'Current period')}
                    value={user.subscription?.currentPeriodEnd
                      ? `${formatDate(user.subscription.currentPeriodStart ?? user.subscription.createdAt, language, { dateStyle: 'medium' })} → ${formatDate(user.subscription.currentPeriodEnd, language, { dateStyle: 'medium' })}`
                      : '—'}
                    mono
                  />
                  <DetailRow
                    label={copy('Renovação', 'Renewal')}
                    value={user.subscription?.cancelAtPeriodEnd
                      ? copy('Cancelamento ao fim do período', 'Cancels at period end')
                      : user.subscription ? copy('Renovação habilitada', 'Renewal enabled') : '—'}
                  />
                </dl>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-ink">{copy('Organização', 'Organization')}</h3>
                <dl className="mt-3">
                  <DetailRow label={copy('Agência', 'Agency')} value={user.agency?.name ?? copy('Sem agência', 'No agency')} />
                  <DetailRow
                    label={copy('Vínculo', 'Relationship')}
                    value={user.agency?.membershipRole === 'OWNER'
                      ? copy('Responsável pela agência', 'Agency owner')
                      : user.agency?.membershipRole === 'MEMBER'
                        ? copy('Membro da agência', 'Agency member')
                        : copy('Conta individual', 'Individual account')}
                  />
                  <DetailRow label={copy('Agência base', 'Parent agency')} value={user.agency?.parentAgency?.name ?? '—'} />
                  <DetailRow label={copy('Gestor direto', 'Direct manager')} value={user.agent?.parentAgent?.name ?? '—'} />
                  <DetailRow
                    label={copy('Equipe conectada', 'Connected team')}
                    value={user.agency
                      ? copy(
                          `${user.agency.activeMemberCount} membros · ${user.agency.childAgencyCount} subagências`,
                          `${user.agency.activeMemberCount} members · ${user.agency.childAgencyCount} sub-agencies`,
                        )
                      : user.agent
                        ? copy(`${user.agent.counts.subAgents} agentes`, `${user.agent.counts.subAgents} agents`)
                        : '—'}
                  />
                  <DetailRow
                    label={copy('Onboarding', 'Onboarding')}
                    value={user.agent?.onboarding
                      ? `${operationalStatusLabel(user.agent.onboarding.status, copy)} · ${copy('etapa', 'step')} ${operationalStatusLabel(user.agent.onboarding.currentStep, copy)}`
                      : copy('Sem onboarding', 'No onboarding')}
                  />
                </dl>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border-steel bg-paper p-5 sm:p-6">
            <SectionHeading
              eyebrow={copy('Atividade e conexões', 'Activity and connections')}
              title={copy('Sessões, integrações e agenda', 'Sessions, integrations, and scheduling')}
            />

            <div className="grid gap-7 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">{copy('Sessões recentes', 'Recent sessions')}</h3>
                {user.sessions.length > 0 ? (
                  <ul className="mt-3 divide-y divide-border-steel">
                    {user.sessions.map((item) => (
                      <li key={item.id} className="py-3 first:pt-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-ink">{deviceName(item.userAgent, copy)}</p>
                            <p className="mt-1 font-mono text-xs text-ink-muted">IP {maskIp(item.ipAddress, copy)}</p>
                          </div>
                          <StatusMark tone={item.expiresAt > new Date() ? 'success' : 'neutral'}>
                            {item.expiresAt > new Date() ? copy('Ativa', 'Active') : copy('Expirada', 'Expired')}
                          </StatusMark>
                        </div>
                        <p className="mt-2 text-xs text-ink-muted">
                          {copy('Atualizada em', 'Updated on')} {formatDate(item.updatedAt, language, { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-ink-muted">{copy('Nenhuma sessão registrada.', 'No sessions recorded.')}</p>}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-ink">{copy('Integrações', 'Integrations')}</h3>
                <ul className="mt-3 divide-y divide-border-steel">
                  {user.calendarIntegrations.map((integration) => (
                    <li key={integration.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">Google Calendar</p>
                        <p className="mt-1 truncate text-xs text-ink-muted">{integration.providerEmail ?? integration.displayName ?? copy('Conta conectada', 'Connected account')}</p>
                      </div>
                      <StatusMark tone={integrationStatusTone(integration.status)}>{operationalStatusLabel(integration.status, copy)}</StatusMark>
                    </li>
                  ))}
                  {user.agent?.integrationSessions.map((integration) => (
                    <li key={integration.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{integration.provider.replaceAll('_', ' ')}</p>
                        <p className="mt-1 text-xs text-ink-muted">{copy('Integração de produção', 'Production integration')}</p>
                      </div>
                      <StatusMark tone={integrationStatusTone(integration.status)}>{operationalStatusLabel(integration.status, copy)}</StatusMark>
                    </li>
                  ))}
                  {user.agent?.messagingChannels.map((channel) => (
                    <li key={channel.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{channel.provider}</p>
                        <p className="mt-1 text-xs text-ink-muted">{channel.kind.replaceAll('_', ' ')}</p>
                      </div>
                      <StatusMark tone={integrationStatusTone(channel.status)}>{operationalStatusLabel(channel.status, copy)}</StatusMark>
                    </li>
                  ))}
                </ul>
                {user.calendarIntegrations.length === 0
                  && (user.agent?.integrationSessions.length ?? 0) === 0
                  && (user.agent?.messagingChannels.length ?? 0) === 0 ? (
                    <p className="mt-3 text-sm text-ink-muted">{copy('Nenhuma integração configurada.', 'No integrations configured.')}</p>
                  ) : null}
                {user.schedulingPage ? (
                  <div className="mt-4 border-t border-border-steel pt-4">
                    <p className="text-xs font-medium text-ink-muted">{copy('Página de agendamento', 'Scheduling page')}</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-ink">/{user.schedulingPage.slug}</p>
                      <StatusMark tone={user.schedulingPage.enabled ? 'success' : 'neutral'}>
                        {user.schedulingPage.enabled ? copy('Publicada', 'Published') : copy('Desativada', 'Disabled')}
                      </StatusMark>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-7 border-t border-border-steel pt-6">
              <h3 className="text-sm font-semibold text-ink">{copy('Agendamentos recentes', 'Recent bookings')}</h3>
              {user.recentBookings.length > 0 ? (
                <div className="mt-3 overflow-x-auto" role="region" aria-label={copy('Agendamentos recentes', 'Recent bookings')} tabIndex={0}>
                  <table className="w-full min-w-[620px] border-collapse">
                    <thead>
                      <tr className="border-b border-border-steel text-left">
                        <th className="pb-3 text-xs font-semibold text-ink-muted">{copy('Cliente', 'Invitee')}</th>
                        <th className="pb-3 text-xs font-semibold text-ink-muted">{copy('Data', 'Date')}</th>
                        <th className="pb-3 text-xs font-semibold text-ink-muted">{copy('Status', 'Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {user.recentBookings.map((booking) => (
                        <tr key={booking.id} className="border-b border-border-steel last:border-0">
                          <td className="py-3 pr-5">
                            <p className="text-sm font-medium text-ink">{booking.inviteeName}</p>
                            <p className="mt-1 text-xs text-ink-muted">{booking.inviteeEmail}</p>
                          </td>
                          <td className="py-3 pr-5 font-mono text-xs text-ink">
                            {formatDate(booking.startsAt, language, { dateStyle: 'medium', timeStyle: 'short', timeZone: user.timeZone })}
                          </td>
                          <td className="py-3"><StatusMark tone={integrationStatusTone(booking.status)}>{operationalStatusLabel(booking.status, copy)}</StatusMark></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="mt-3 text-sm text-ink-muted">{copy('Nenhum agendamento registrado.', 'No bookings recorded.')}</p>}
            </div>
          </section>

          <section className="rounded-xl border border-border-steel bg-paper p-5 sm:p-6">
            <SectionHeading
              eyebrow={copy('Rastreabilidade', 'Traceability')}
              title={copy('Histórico administrativo', 'Administrative history')}
              description={copy('As ações sensíveis ficam vinculadas ao administrador que as executou.', 'Sensitive actions stay linked to the administrator who performed them.')}
            />
            {user.auditLogs.length > 0 ? (
              <ol className="divide-y divide-border-steel">
                {user.auditLogs.map((log) => (
                  <li key={log.id} className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5">
                    <div>
                      <p className="text-sm font-medium capitalize text-ink">{actionLabel(log.action, copy)}</p>
                      <p className="mt-1 text-xs text-ink-muted">{copy('Por', 'By')} {log.actorName}</p>
                    </div>
                    <time className="font-mono text-xs text-ink-muted" dateTime={log.createdAt.toISOString()}>
                      {formatDate(log.createdAt, language, { dateStyle: 'short', timeStyle: 'short' })}
                    </time>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-ink-muted">{copy('Nenhuma ação administrativa registrada.', 'No administrative actions recorded.')}</p>}
          </section>
        </div>

        <aside className="space-y-6 2xl:sticky 2xl:top-24">
          <section className="rounded-xl border border-border-steel bg-paper p-5">
            <div className="flex items-center gap-3 border-b border-border-steel pb-5">
              <Avatar name={user.name} rank={user.agent?.rank} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
                <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
              </div>
            </div>
            <dl className="mt-2">
              <DetailRow label={copy('Acesso', 'Access')} value={<StatusMark tone={user.accessStatus === 'ACTIVE' ? 'success' : 'danger'}>{accessLabel(user.accessStatus, copy)}</StatusMark>} />
              <DetailRow label={copy('E-mail', 'Email')} value={user.emailVerified ? copy('Verificado', 'Verified') : copy('Pendente', 'Pending')} />
              <DetailRow label={copy('Idioma', 'Language')} value={user.language === 'PT' ? 'Português' : 'English'} />
              <DetailRow label={copy('Fuso', 'Time zone')} value={user.timeZone} mono />
            </dl>
          </section>

          <section className="rounded-xl border border-[#183e2a] bg-[#07130d] p-5 text-white" aria-labelledby="user-preview-heading">
            <div className="mb-5 border-b border-white/10 pb-5">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-[#8ef0b5]">
                {copy('Suporte interno', 'Internal support')}
              </p>
              <h2 id="user-preview-heading" className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                {copy('Visualizar como usuário', 'View as user')}
              </h2>
              <p className="mt-2 text-xs leading-5 text-white/55">
                {copy(
                  'Abra a experiência real da conta para diagnosticar o que o usuário vê, sem permitir alterações.',
                  'Open the account’s real experience to diagnose what the user sees, without allowing changes.',
                )}
              </p>
            </div>
            <ManagedUserPreviewControl
              userId={user.id}
              role={user.role}
              accessStatus={user.accessStatus}
              isCurrentUser={isCurrentUser}
              hasOperationalProfile={user.role === 'AGENT'
                ? user.agent?.status === 'ACTIVE'
                : user.role === 'CLIENT'
                  ? Boolean(user.client)
                  : false}
              isAgency={user.plan === 'AGENCY'}
            />
          </section>

          <section className="rounded-xl border border-border-steel bg-paper p-5" aria-labelledby="security-heading">
            <div className="mb-5 border-b border-border-steel pb-5">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-teal">{copy('Segurança', 'Security')}</p>
              <h2 id="security-heading" className="mt-2 text-lg font-semibold tracking-[-0.03em] text-ink">
                {copy('Acesso e credenciais', 'Access and credentials')}
              </h2>
            </div>
            <ManagedUserSecurityControls
              userId={user.id}
              email={user.email}
              expectedUpdatedAt={user.updatedAt.toISOString()}
              pendingEmailChange={user.pendingEmailChange
                ? {
                    newEmail: user.pendingEmailChange.newEmail,
                    expiresAt: (user.pendingEmailChange.newTokenExpiresAt
                      ?? user.pendingEmailChange.expiresAt).toISOString(),
                    currentApproved: Boolean(user.pendingEmailChange.currentApprovedAt),
                  }
                : null}
              accessStatus={user.accessStatus}
              banReason={user.banReason}
              emailVerified={user.emailVerified}
              sessionCount={user.sessionCount}
              isCurrentUser={isCurrentUser}
              role={user.role}
            />
          </section>

          <section className="rounded-xl border border-border-steel bg-panel p-5">
            <p className="text-sm font-semibold text-ink">{copy('Limites de segurança', 'Security boundaries')}</p>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-ink-muted">
              <li>• {copy('Suspender não cancela a assinatura.', 'Suspension does not cancel billing.')}</li>
              <li>• {copy('Plano e tipo de usuário seguem fluxos protegidos.', 'Plan and user type use protected workflows.')}</li>
              <li>• {copy('Senhas e tokens nunca aparecem neste painel.', 'Passwords and tokens never appear in this panel.')}</li>
              <li>• {copy('Toda ação sensível entra na auditoria.', 'Every sensitive action is audited.')}</li>
            </ul>
          </section>
        </aside>
      </div>
    </Shell>
  )
}
