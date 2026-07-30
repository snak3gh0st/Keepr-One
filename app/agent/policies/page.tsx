import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineIds } from '@/lib/hierarchy'
import { decimalToNumber } from '@/lib/decimal'
import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/ErrorBanner'
import { ContextPanel } from '@/components/ContextPanel'
import { ModuleSummary } from '@/components/ModuleSummary'
import { PoliciesList } from './PoliciesList'

export const dynamic = 'force-dynamic'

export default async function PoliciesPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
  const scopeAgentIds = [agent.id, ...getDownlineIds(allAgents, agent.id)]

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
  const inforcePolicies = policies.filter((policy) => policy.status === 'INFORCE').length
  const attentionPolicies = policies.filter((policy) => ['PENDING', 'LAPSED', 'CANCELLED'].includes(policy.status)).length
  // A carrier-sourced policy with a zero premium means the portal did not supply
  // one, not that the premium is zero. Counting those would understate nothing
  // and overstate coverage of the figure, so they are excluded and reported.
  const premiumIsKnown = (policy: { premium: unknown; sourceProvider: string | null }) =>
    policy.sourceProvider === null || decimalToNumber(policy.premium) > 0
  const policiesWithoutPremium = policies.filter((policy) => !premiumIsKnown(policy)).length
  const totalPremium = policies
    .filter(premiumIsKnown)
    .reduce((sum, policy) => sum + decimalToNumber(policy.premium), 0)

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader title="Apólices" eyebrow="Proteção em curso" description="Vigência, prêmio e sinais de atenção organizados para cuidar da carteira antes do próximo ciclo.">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/agent/cases/new"
            className="inline-flex items-center bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-transform duration-300 hover:-translate-y-0.5"
          >
            Novo atendimento
          </Link>
          <Link
            href="/agent/illustrations/new"
            className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
          >
            Nova ilustração
          </Link>
        </div>
      </PageHeader>
      {loadError && (
        <ErrorBanner>Não foi possível carregar suas apólices agora. Tente atualizar a página.</ErrorBanner>
      )}

      {!loadError && (
        <ModuleSummary
          label="Resumo da carteira de apólices"
          items={[
            { label: 'Apólices', value: policies.length, detail: 'Contratos dentro da sua operação' },
            { label: 'Em vigor', value: inforcePolicies, detail: 'Proteções ativas na carteira', tone: 'green' },
            {
              label: 'Prêmio registrado',
              value: `$${totalPremium.toFixed(0)}`,
              detail:
                policiesWithoutPremium > 0
                  ? `${policiesWithoutPremium} sem prêmio informado pela seguradora`
                  : `${attentionPolicies} item(ns) pedem atenção`,
              tone: attentionPolicies > 0 ? 'gold' : 'neutral',
            },
          ]}
        />
      )}

      <div className="module-content-grid">
      <section className="module-main-surface">
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
      </section>
      <ContextPanel eyebrow="Continue por aqui" title="Carteira sob controle">
        <p>O status mostra a situação atual da apólice. O prêmio é o valor recorrente registrado para ela.</p>
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Detalhes</p>
          <p className="mt-2">Selecione uma linha para abrir a apólice completa e seus documentos.</p>
        </div>
      </ContextPanel>
      </div>
    </Shell>
  )
}
