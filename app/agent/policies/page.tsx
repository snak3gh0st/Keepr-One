import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/ErrorBanner'
import { PoliciesList } from './PoliciesList'
import { getServerI18n } from '@/lib/i18n/server'
import { isNationalPolicyQueueKey } from '@/lib/national-life/policy-queues'
import { loadNationalPolicyQueues } from '@/lib/national-life/policy-queues-prisma'
import { NationalPolicyQueueTable, nationalPolicyQueueTitle } from './NationalPolicyQueueTable'
import {
  parsePolicyDirectoryFilters,
  readCurrentPolicyDirectory,
  readHistoryPolicyDirectory,
  type PolicyDirectoryResult,
} from '@/lib/national-life/policy-directory'

export const dynamic = 'force-dynamic'

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { copy, language } = await getServerI18n()
  const params = await searchParams
  const requestedQueue = Array.isArray(params.queue) ? params.queue[0] : params.queue
  const filters = parsePolicyDirectoryFilters(params)
  const history = filters.view === 'history'
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

  let directory: PolicyDirectoryResult | null = null
  let loadError = false
  let verified = true

  try {
    if (!history) {
      directory = await readCurrentPolicyDirectory(prisma, scopeAgentIds, filters)
    } else {
      directory = await readHistoryPolicyDirectory(prisma, scopeAgentIds, filters)
    }
    verified = directory.verified
  } catch (error) {
    console.error('Policies query error', error)
    loadError = true
  }
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
        directory && <PoliciesList {...directory} />
      )}
    </Shell>
  )
}
