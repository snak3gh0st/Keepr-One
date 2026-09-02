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
import { getServerI18n } from '@/lib/i18n/server'
import { localeFor } from '@/lib/i18n/config'

/// Everything the book already knows about one person, in one place.
///
/// This route was being linked to from the illustrations list and did not
/// exist — the link 404'd. The quotes were the reason to build it: a quote
/// names an insured and a premium, and until now it could be read from the
/// illustrations list but never from the client it belongs to.
export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { copy, language } = await getServerI18n()
  const locale = localeFor(language)
  const currency = (value: number) => new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value)
  const date = (value: Date | null) => (value ? value.toLocaleDateString(locale) : '—')
  const policyLabel = (status: string) => ({
    INFORCE: copy('Em vigor', 'In force'), APPROVED: copy('Aprovada', 'Approved'),
    PENDING: copy('Pendente', 'Pending'), LAPSED: copy('Lapsada', 'Lapsed'),
    CANCELLED: copy('Cancelada', 'Cancelled'),
  } as Record<string, string>)[status] ?? policyStatusLabel[status] ?? status
  const caseStatus = (status: string) => ({
    OPEN: copy('Aberto', 'Open'), CLOSED: copy('Fechado', 'Closed'),
    ARCHIVED: copy('Arquivado', 'Archived'),
  } as Record<string, string>)[status] ?? status
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
        eyebrow={copy("Cliente", "Client")}
        description={[client.email, client.phone].filter(Boolean).join(' · ') || copy('Sem contato registrado', 'No contact information recorded')}
      />

      <ModuleSummary
        items={[
          { label: copy('Apólices em vigor', 'Policies in force'), value: `${inforce} / ${policies.length}`, detail: copy('Proteções ativas', 'Active coverage') },
          { label: copy('Casos', 'Cases'), value: String(insuranceCases.length), detail: copy('Processos abertos', 'Open cases') },
          { label: copy('Cotações', 'Quotes'), value: String(illustrations.length), detail: copy('Pedidas à seguradora', 'Requested from the carrier') },
          { label: copy('Nascimento', 'Date of birth'), value: date(client.dateOfBirth), detail: copy('Data informada pela seguradora', 'Date provided by the carrier') },
        ]}
      />

      <section className="module-main-surface">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {copy('Apólices', 'Policies')}
        </h2>
        <Table>
          <Thead>
            <tr>
              <Th>{copy('Apólice', 'Policy')}</Th>
              <Th>{copy('Produto', 'Product')}</Th>
              <Th>{copy('Status', 'Status')}</Th>
              <Th className="text-right">{copy('Capital segurado', 'Face amount')}</Th>
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
                <Td>{policyLabel(policy.status)}</Td>
                <TdNum>{policy.faceAmount ? currency(Number(policy.faceAmount)) : '—'}</TdNum>
              </Tr>
            ))}
          </tbody>
        </Table>
        {policies.length === 0 && <EmptyState>{copy('Nenhuma apólice.', 'No policies.')}</EmptyState>}
      </section>

      <section className="module-main-surface">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {copy('Cotações', 'Quotes')}
        </h2>
        <Table>
          <Thead>
            <tr>
              <Th>{copy('Data', 'Date')}</Th>
              <Th>{copy('Segurado', 'Insured')}</Th>
              <Th>{copy('Produto', 'Product')}</Th>
              <Th className="text-right">{copy('Capital segurado', 'Face amount')}</Th>
              <Th className="text-right">{copy('Prêmio mensal', 'Monthly premium')}</Th>
              <Th>{copy('Documento', 'Document')}</Th>
            </tr>
          </Thead>
          <tbody>
            {illustrations.map((illustration) => {
              const quote = summarizeQuotePayload(illustration.rawPayload)
              const asked = [
                quote.issueAge === null ? null : copy('{count} anos', '{count} years old', { count: quote.issueAge }),
                quote.gender,
                quote.issueState,
                quote.rateClass,
              ].filter(Boolean)

              return (
                <Tr key={illustration.id}>
                  <Td>{illustration.createdAt.toLocaleDateString(locale)}</Td>
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
                        {currency(quote.annualPremium)} {copy('/ano', '/year')}
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
                        {copy('Abrir PDF', 'Open PDF')}
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
          <EmptyState>{copy('Nenhuma cotação para este cliente.', 'No quotes for this client.')}</EmptyState>
        ) : (
          // The carrier's condition travels with the number, wherever it shows.
          <p className="mt-4 border-l-2 border-border-steel pl-3 text-xs leading-5 text-ink-muted">
            {QUOTE_DISCLAIMER}
          </p>
        )}
      </section>

      <section className="module-main-surface">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {copy('Casos', 'Cases')}
        </h2>
        <Table>
          <Thead>
            <tr>
              <Th>{copy('Aberto em', 'Opened on')}</Th>
              <Th>{copy('Status', 'Status')}</Th>
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
                    {insuranceCase.createdAt.toLocaleDateString(locale)}
                  </Link>
                </Td>
                <Td>{caseStatus(insuranceCase.status)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {insuranceCases.length === 0 && <EmptyState>{copy('Nenhum caso.', 'No cases.')}</EmptyState>}
      </section>
    </Shell>
  )
}
