export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ModuleSummary } from '@/components/ModuleSummary'
import { policyStatusLabel } from '@/components/StatusPill'
import { Table, Thead, Th, Tr, Td, TdNum, EmptyState } from '@/components/Table'
import { summarizeQuotePayload } from '@/lib/national-life/quote-summary'
import { QUOTE_DISCLAIMER } from '@/lib/national-life/quote-disclaimer'

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

const date = (value: Date | null) => (value ? value.toLocaleDateString('pt-BR') : '—')

/// Everything the book already knows about one person, in one place.
///
/// This route was being linked to from the illustrations list and did not
/// exist — the link 404'd. The quotes were the reason to build it: a quote
/// names an insured and a premium, and until now it could be read from the
/// illustrations list but never from the client it belongs to.
export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireRole('ADMIN', 'AGENT')

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      assignedAgent: { include: { user: { select: { name: true } } } },
    },
  })
  if (!client) notFound()

  // A 404 rather than a 403 keeps the route from confirming that a client
  // exists to someone outside the subscription-authorized book.
  let allowed = session.user.role === 'ADMIN'
  let scopeIds: string[] | null = null
  if (session.user.role === 'AGENT') {
    const agent = await getCurrentAgent()
    scopeIds = await getAgentScopeIds(agent.id)
    allowed = scopeIds.includes(client.assignedAgentId)
  }
  if (!allowed) notFound()

  // Child rows have their own agent ownership. Filtering only the Client would
  // let an inconsistent import attach another agent's policy/case/illustration
  // and leak it through this aggregate page.
  const [policies, insuranceCases, illustrations] = await Promise.all([
    prisma.policy.findMany({
      where: {
        clientId: client.id,
        ...(scopeIds ? { agentId: { in: scopeIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.insuranceCase.findMany({
      where: {
        clientId: client.id,
        ...(scopeIds ? { assignedAgentId: { in: scopeIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.illustration.findMany({
      where: {
        clientId: client.id,
        ...(scopeIds ? { agentId: { in: scopeIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])

  const inforce = policies.filter((policy) => policy.status === 'INFORCE').length

  return (
    <Shell role={session.user.role === 'ADMIN' ? 'ADMIN' : 'AGENT'} userName={session.user.name ?? ''}>
      <PageHeader
        title={client.name}
        eyebrow="Cliente"
        description={[client.email, client.phone].filter(Boolean).join(' · ') || 'Sem contato registrado'}
      />

      <ModuleSummary
        items={[
          { label: 'Apólices em vigor', value: `${inforce} / ${policies.length}`, detail: 'Proteções ativas' },
          { label: 'Casos', value: String(insuranceCases.length), detail: 'Processos abertos' },
          { label: 'Cotações', value: String(illustrations.length), detail: 'Pedidas à seguradora' },
          { label: 'Nascimento', value: date(client.dateOfBirth), detail: 'Data informada pela seguradora' },
        ]}
      />

      <section className="module-main-surface">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Apólices
        </h2>
        <Table>
          <Thead>
            <tr>
              <Th>Apólice</Th>
              <Th>Produto</Th>
              <Th>Status</Th>
              <Th className="text-right">Capital segurado</Th>
            </tr>
          </Thead>
          <tbody>
            {policies.map((policy) => (
              <Tr key={policy.id}>
                <Td>
                  <Link
                    href={`/agent/policies/${policy.id}`}
                    className="text-teal hover:text-teal-deep"
                  >
                    {policy.policyNumber}
                  </Link>
                </Td>
                <Td>{policy.product}</Td>
                <Td>{policyStatusLabel[policy.status] ?? policy.status}</Td>
                <TdNum>{policy.faceAmount ? currency(Number(policy.faceAmount)) : '—'}</TdNum>
              </Tr>
            ))}
          </tbody>
        </Table>
        {policies.length === 0 && <EmptyState>Nenhuma apólice.</EmptyState>}
      </section>

      <section className="module-main-surface">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Cotações
        </h2>
        <Table>
          <Thead>
            <tr>
              <Th>Data</Th>
              <Th>Segurado</Th>
              <Th>Produto</Th>
              <Th className="text-right">Capital segurado</Th>
              <Th className="text-right">Prêmio mensal</Th>
              <Th>Documento</Th>
            </tr>
          </Thead>
          <tbody>
            {illustrations.map((illustration) => {
              const quote = summarizeQuotePayload(illustration.rawPayload)
              const asked = [
                quote.issueAge === null ? null : `${quote.issueAge} anos`,
                quote.gender,
                quote.issueState,
                quote.rateClass,
              ].filter(Boolean)

              return (
                <Tr key={illustration.id}>
                  <Td>{illustration.createdAt.toLocaleDateString('pt-BR')}</Td>
                  <Td>
                    <span className="block">{illustration.insuredName ?? '—'}</span>
                    {asked.length > 0 && (
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {asked.join(' · ')}
                      </span>
                    )}
                  </Td>
                  <Td>{illustration.productName ?? '—'}</Td>
                  <TdNum>
                    {illustration.faceAmount ? currency(Number(illustration.faceAmount)) : '—'}
                  </TdNum>
                  <TdNum>
                    <span className="block">
                      {illustration.premium ? currency(Number(illustration.premium)) : '—'}
                    </span>
                    {quote.annualPremium !== null && (
                      <span className="mt-0.5 block text-xs font-normal text-ink-muted">
                        {currency(quote.annualPremium)} /ano
                      </span>
                    )}
                  </TdNum>
                  <Td>
                    {illustration.documentFetchedAt ? (
                      <a
                        href={`/api/illustrations/${illustration.id}/document`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-teal hover:text-teal-deep"
                      >
                        Abrir PDF
                      </a>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </Table>
        {illustrations.length === 0 ? (
          <EmptyState>Nenhuma cotação para este cliente.</EmptyState>
        ) : (
          // The carrier's condition travels with the number, wherever it shows.
          <p className="mt-4 border-l-2 border-border-steel pl-3 text-xs leading-5 text-ink-muted">
            {QUOTE_DISCLAIMER}
          </p>
        )}
      </section>

      <section className="module-main-surface">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Casos
        </h2>
        <Table>
          <Thead>
            <tr>
              <Th>Aberto em</Th>
              <Th>Status</Th>
            </tr>
          </Thead>
          <tbody>
            {insuranceCases.map((insuranceCase) => (
              <Tr key={insuranceCase.id}>
                <Td>
                  <Link
                    href={`/agent/cases/${insuranceCase.id}`}
                    className="text-teal hover:text-teal-deep"
                  >
                    {insuranceCase.createdAt.toLocaleDateString('pt-BR')}
                  </Link>
                </Td>
                <Td>{insuranceCase.status}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {insuranceCases.length === 0 && <EmptyState>Nenhum caso.</EmptyState>}
      </section>
    </Shell>
  )
}
