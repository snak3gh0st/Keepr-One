export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { summarizeQuotePayload } from '@/lib/national-life/quote-summary'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { Table, Thead, Th, Tr, Td, TdNum, EmptyState } from '@/components/Table'

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

export default async function IllustrationsPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })

  // Scoped to the agent who asked for them. A quote names an insured and a
  // premium, and the only thing that says who may read it is who requested it.
  const illustrations = await prisma.illustration.findMany({
    where: { agentId: agent.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      createdAt: true,
      insuredName: true,
      insuredDateOfBirth: true,
      faceAmount: true,
      premium: true,
      productName: true,
      provider: true,
      // Both sides of the carrier exchange were persisted; the question is what
      // makes the answer mean anything. Two quotes at the same face amount are
      // different quotes if the insured is not the same age or rate class.
      rawPayload: true,
      client: { select: { id: true, name: true } },
    },
  })

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Ilustrações"
        eyebrow="Carteira"
        description="Cotações pedidas à seguradora, com os números que ela devolveu."
      >
        <Link
          href="/agent/illustrations/new"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          Nova cotação
        </Link>
      </PageHeader>

      <section className="module-main-surface">
        <Table>
          <Thead>
            <tr>
              <Th>Data</Th>
              <Th>Segurado</Th>
              <Th>Cliente</Th>
              <Th>Produto</Th>
              <Th className="text-right">Capital segurado</Th>
              <Th className="text-right">Prêmio mensal</Th>
            </tr>
          </Thead>
          <tbody>
            {illustrations.map((illustration) => {
              const quote = summarizeQuotePayload(illustration.rawPayload)
              // Age, state and rate class in one line under the name: it is the
              // question the carrier answered, and without it the premium below
              // is a number with no meaning attached.
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
                <Td>
                  {illustration.client ? (
                    <Link
                      href={`/agent/clients/${illustration.client.id}`}
                      className="text-teal hover:text-teal-deep"
                    >
                      {illustration.client.name}
                    </Link>
                  ) : (
                    // Not a gap: a pre-sale quote is for someone who is not in
                    // the book yet, which is the ordinary case.
                    <span className="text-ink-muted">Prospect</span>
                  )}
                </Td>
                <Td>
                  <span className="block">{illustration.productName ?? '—'}</span>
                  {quote.strategy && (
                    <span className="mt-0.5 block text-xs text-ink-muted">{quote.strategy}</span>
                  )}
                </Td>
                <TdNum>
                  {illustration.faceAmount ? currency(Number(illustration.faceAmount)) : '—'}
                </TdNum>
                <TdNum>
                  <span className="block">
                    {illustration.premium ? currency(Number(illustration.premium)) : '—'}
                  </span>
                  {/* The carrier returns both, and an agent quotes whichever the
                      client asks for. Storing one and dropping the other made
                      the annual figure a second round trip for no reason. */}
                  {quote.annualPremium !== null && (
                    <span className="mt-0.5 block text-xs font-normal text-ink-muted">
                      {currency(quote.annualPremium)} /ano
                    </span>
                  )}
                </TdNum>
              </Tr>
              )
            })}
          </tbody>
        </Table>

        {illustrations.length === 0 && (
          <EmptyState>Nenhuma cotação pedida ainda.</EmptyState>
        )}

        {illustrations.length > 0 && (
          // The carrier's condition travels with the number, so it appears
          // wherever the number does.
          <p className="mt-4 border-l-2 border-border-steel pl-3 text-xs leading-5 text-ink-muted">
            Uso interno do corretor. Pode ser usado para uma cotação verbal ao cliente, mas não
            pode ser exibido a ele. Os valores não são garantidos e dependem de aprovação de
            proposta completa na emissão.
          </p>
        )}
      </section>
    </Shell>
  )
}
