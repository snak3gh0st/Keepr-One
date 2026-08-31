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

export const dynamic = 'force-dynamic'

export default async function PoliciesPage() {
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const scopeAgentIds = await getAgentScopeIds(agent.id)

  let policies: {
    id: string
    policyNumber: string
    carrier: string
    product: string
    premium: unknown
    status: string
    sourceProvider: string | null
    client: { name: string } | null
  }[] = []
  let loadError = false

  try {
    policies = await prisma.policy.findMany({
      where: { agentId: { in: scopeAgentIds } },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    })
  } catch (error) {
    console.error('Policies query error', error)
    loadError = true
  }
  // A carrier-sourced policy with a zero premium means the portal did not supply
  // one, not that the premium is zero. Counting those would understate nothing
  // and overstate coverage of the figure, so they are excluded and reported.
  const premiumIsKnown = (policy: { premium: unknown; sourceProvider: string | null }) =>
    policy.sourceProvider === null || decimalToNumber(policy.premium) > 0

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader title={copy("Apólices", "Policies")} eyebrow={copy("Proteção em curso", "Protection in force")} description={copy("Vigência, prêmio e sinais de atenção organizados para cuidar da carteira antes do próximo ciclo.", "Coverage dates, premiums, and attention signals organized so you can care for the portfolio before the next cycle.")}>
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
            premium: premiumIsKnown(p) ? decimalToNumber(p.premium).toFixed(2) : null,
            status: p.status,
            clientName: p.client?.name ?? '—',
          }))}
        />
      )}
    </Shell>
  )
}
