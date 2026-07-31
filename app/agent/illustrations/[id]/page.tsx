export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { summarizeQuotePayload } from '@/lib/national-life/quote-summary'
import { carrierLabel } from '@/lib/national-life/rapid-solve-labels'
import { IllustrationPdfButton } from '../IllustrationPdfButton'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

const day = (value: Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(value)

/// Nothing here is computed. Every value either came from the carrier or is
/// absent, and absent renders as an em dash rather than as a zero.
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-t border-white/10 py-3">
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value ?? '—'}</dd>
    </div>
  )
}

export default async function QuoteSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })

  // Scoped in the query, not checked after it: a quote names an insured and a
  // premium, and someone else's id must be indistinguishable from a missing one.
  const illustration = await prisma.illustration.findFirst({
    where: { id, agentId: agent.id },
    select: {
      id: true,
      createdAt: true,
      insuredName: true,
      insuredDateOfBirth: true,
      productName: true,
      documentFetchedAt: true,
      rawPayload: true,
    },
  })
  if (!illustration) notFound()

  const facts = summarizeQuotePayload(illustration.rawPayload)

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Resumo da cotação"
        eyebrow="Carteira"
        description="Os números que a seguradora devolveu, do jeito que ela devolveu."
      >
        <Link
          href="/agent/illustrations"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          Voltar
        </Link>
      </PageHeader>

      {facts.ok === false && (
        <p className="mb-6 border border-gold/30 px-4 py-3 text-sm text-gold">
          A seguradora não cotou este pedido. Não há capital nem prêmio para mostrar.
        </p>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold text-paper">Segurado</h2>
          <dl>
            <Fact label="Nome" value={illustration.insuredName} />
            <Fact
              label="Nascimento"
              value={illustration.insuredDateOfBirth ? day(illustration.insuredDateOfBirth) : null}
            />
            {/* ANB, not current age: the two differ for half the year, and an
                agent who confuses them misprices the conversation. */}
            <Fact
              label="Issue age (ANB)"
              value={facts.issueAge !== null ? String(facts.issueAge) : null}
            />
            <Fact label="Sexo" value={facts.gender} />
            <Fact label="Estado de emissão" value={facts.issueState} />
            <Fact label="Rate class" value={carrierLabel('rateClass', facts.rateClass)} />
          </dl>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-paper">O que foi pedido</h2>
          <dl>
            <Fact label="Solve type" value={carrierLabel('solveType', facts.solveType)} />
            <Fact
              label="Death benefit option"
              value={carrierLabel('deathBenefitOption', facts.deathBenefitOption)}
            />
            <Fact label="Strategy" value={carrierLabel('strategy', facts.strategy)} />
            <Fact
              label="Allocation"
              value={facts.allocation !== null ? `${facts.allocation}%` : null}
            />
            <Fact label="Premium mode" value={facts.premiumMode} />
            {/* The carrier stores a code here, not a name. Showing the code is
                the honest thing; inventing a product name is not. */}
            <Fact
              label="Product code"
              value={facts.productCode ?? illustration.productName}
            />
          </dl>
        </section>

        <section className="md:col-span-2">
          <h2 className="text-sm font-semibold text-paper">O que a seguradora respondeu</h2>
          <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
            <Fact
              label="Capital segurado"
              value={facts.faceAmount !== null ? currency(facts.faceAmount) : null}
            />
            <Fact
              label="Prêmio mensal"
              value={facts.monthlyPremium !== null ? currency(facts.monthlyPremium) : null}
            />
            <Fact
              label="Prêmio anual"
              value={facts.annualPremium !== null ? currency(facts.annualPremium) : null}
            />
            {/* null is "does not lapse", not year zero. */}
            <Fact
              label="Lapse"
              value={facts.lapseYear === null ? 'Não lapsa' : `Ano ${facts.lapseYear}`}
            />
          </dl>
        </section>
      </div>

      <section className="mt-10 border-t border-white/10 pt-6 text-sm text-ink-muted">
        <p>
          Números fornecidos por National Life (Rapid Solve) em {day(illustration.createdAt)}.
          Servem para cotação verbal. O documento oficial é a ilustração em PDF da seguradora.
        </p>
        <div className="mt-3">
          {illustration.documentFetchedAt ? (
            <a
              href={`/api/illustrations/${illustration.id}/document`}
              target="_blank"
              rel="noreferrer"
              className="text-teal hover:text-teal-deep"
            >
              Abrir PDF da seguradora
            </a>
          ) : (
            <IllustrationPdfButton illustrationId={illustration.id} />
          )}
        </div>
      </section>
    </Shell>
  )
}
