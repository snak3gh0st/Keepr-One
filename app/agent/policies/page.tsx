import { loadCurrentNationalLifePortfolio } from '@/lib/national-life/current-portfolio-prisma'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { decimalToNumber } from '@/lib/decimal'
import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/ErrorBanner'
import { PoliciesList } from './PoliciesList'
import { getServerI18n } from '@/lib/i18n/server'
import { isNationalPolicyQueueKey } from '@/lib/national-life/policy-queues'
import { loadNationalPolicyQueues } from '@/lib/national-life/policy-queues-prisma'
import { NationalPolicyQueueTable, nationalPolicyQueueTitle } from './NationalPolicyQueueTable'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUS_FILTERS = new Set([
  'INFORCE',
  'PENDING_LAPSE',
  'APPROVED',
  'PENDING',
  'LAPSED',
  'CANCELLED',
])

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; queue?: string; view?: string }>
}) {
  const { copy, language } = await getServerI18n()
  const { status: requestedStatus, queue: requestedQueue, view } = await searchParams
  const history = view === 'history'
  const initialStatus = requestedStatus && ALLOWED_STATUS_FILTERS.has(requestedStatus)
    ? requestedStatus
    : 'all'
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const scopeAgentIds = await getAgentScopeIds(agent.id)

  if (isNationalPolicyQueueKey(requestedQueue)) {
    let rows: Awaited<ReturnType<typeof loadNationalPolicyQueues>>['queues'][typeof requestedQueue] = []
    let queueLoadError = false
    try {
      const result = await loadNationalPolicyQueues(prisma, scopeAgentIds)
      if (!result.verified) throw new Error('NATIONAL_NEW_BUSINESS_SNAPSHOT_UNVERIFIED')
      rows = result.queues[requestedQueue]
    } catch (error) {
      console.error('National policy queue page error', error)
      queueLoadError = true
    }
    return (
      <Shell role="AGENT" userName={user?.name ?? ''}>
        <PageHeader
          title={nationalPolicyQueueTitle(requestedQueue, language)}
          eyebrow={copy('Fila de apólices', 'Policy queue')}
          description={copy('Recorte da última grade New Business completa da National Life.', 'Filtered from the latest complete National Life New Business grid.')}
        />
        {queueLoadError
          ? <ErrorBanner>{copy('Não foi possível validar esta fila agora.', 'This queue could not be verified right now.')}</ErrorBanner>
          : <NationalPolicyQueueTable rows={rows} queue={requestedQueue} language={language} />}
      </Shell>
    )
  }

  let policies: {
    id: string | null
    policyNumber: string
    carrier: string
    product: string
    faceAmount: unknown
    premium: unknown
    status: string
    sourceStatus: string | null
    statusChangedAt: Date | null
    sourceProvider: string | null
    client?: { name: string } | null
    clientName?: string
  }[] = []
  let loadError = false
  let verified = true

  try {
    if (!history) {
      const current = await loadCurrentNationalLifePortfolio(prisma, scopeAgentIds)
      policies = current.rows
      verified = current.verified
    } else policies = await prisma.policy.findMany({
      where: { agentId: { in: scopeAgentIds } },
      include: { client: true },
      orderBy: [
        { statusChangedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    })
  } catch (error) {
    console.error('Policies query error', error)
    loadError = true
  }
  // Current export rows distinguish an explicit zero from missing (null).
  // Historical CRM imports can use zero as an absent-carrier-value placeholder.
  const premiumIsKnown = (policy: { premium: unknown; sourceProvider: string | null }) =>
    policy.premium !== null && (!history || policy.sourceProvider === null || decimalToNumber(policy.premium) > 0)

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader title={history ? copy("Histórico de apólices", "Policy history") : copy("Apólices atuais", "Current policies")} eyebrow={copy("Proteção em curso", "Protection in force")} description={copy("Vigência, prêmio e sinais de atenção organizados para cuidar da carteira antes do próximo ciclo.", "Coverage dates, premiums, and attention signals organized so you can care for the portfolio before the next cycle.")}>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/agent/cases/new"
            className="inline-flex items-center bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-transform duration-300 hover:-translate-y-0.5"
          >
            {copy("Novo atendimento", "New case")}
          </Link>
          <Link
            href="/agent/illustrations/new"
            className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
          >
            {copy("Nova ilustração", "New illustration")}
          </Link>
        </div>
      </PageHeader>
      <nav className="my-5 flex gap-5" aria-label={copy('Visão da carteira', 'Portfolio view')}>
        <Link href="/agent/policies?view=current" aria-current={!history ? 'page' : undefined}>{copy('Carteira atual', 'Current portfolio')}</Link>
        <Link href="/agent/policies?view=history" aria-current={history ? 'page' : undefined}>{copy('Histórico', 'History')}</Link>
      </nav>
      {history && <p className="mb-5 text-sm text-ink-muted">{copy('Histórico acumulado dos registros locais, incluindo apólices ausentes da carteira atual.', 'Accumulated local records, including policies absent from the current portfolio.')}</p>}
      {!history && !verified && <p className="mb-5 text-sm text-ink-muted">{copy('Cobertura parcial: há registros locais sem uma exportação completa validada.', 'Partial coverage: some local records have no verified complete export.')}</p>}
      {loadError && (
        <ErrorBanner>{copy("Não foi possível carregar suas apólices agora. Tente atualizar a página.", "We couldn't load your policies right now. Try refreshing the page.")}</ErrorBanner>
      )}

      {!loadError && (
        <PoliciesList
          policies={policies.map((p) => ({
            id: p.id,
            policyNumber: p.policyNumber,
            carrier: p.carrier,
            product: p.product,
            faceAmount: p.faceAmount == null ? null : decimalToNumber(p.faceAmount).toFixed(2),
            premium: premiumIsKnown(p) ? decimalToNumber(p.premium).toFixed(2) : null,
            status: p.status,
            sourceStatus: p.sourceStatus,
            statusChangedAt: p.statusChangedAt?.toISOString() ?? null,
            clientName: p.clientName ?? p.client?.name ?? '—',
          }))}
          initialStatus={initialStatus}
        />
      )}
    </Shell>
  )
}
