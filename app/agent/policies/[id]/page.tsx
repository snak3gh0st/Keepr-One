export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineIds } from '@/lib/hierarchy'
import { canAccessPolicy } from '@/lib/policy-access'
import { AnnualReviewCard } from './AnnualReviewCard'
import { PolicyUploadForm } from './PolicyUploadForm'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { policyStatusLabel } from '@/components/StatusPill'
import { Table, Thead, Th, Tr, Td, TdNum, EmptyState } from '@/components/Table'
import { ModuleSummary } from '@/components/ModuleSummary'
import {
  toClientServiceEvents,
  type ClientServiceEvent,
} from '@/lib/national-life/client-intelligence'
import { toCarrierCommissionRecords } from '@/lib/national-life/commission-records'
import { carrierPolicyNumberVariants } from '@/lib/national-life/policy-number'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireRole('ADMIN', 'AGENT')

  const policy = await prisma.policy.findUnique({
    where: { id },
    include: {
      client: true,
      commissionRecords: { include: { agent: { include: { user: true } } }, orderBy: { createdAt: 'desc' } },
      documents: true,
      reviews: { orderBy: { dueAt: 'desc' } },
    },
  })
  if (!policy) notFound()

  let allowed = session.user.role === 'ADMIN'
  if (session.user.role === 'AGENT') {
    const agent = await getCurrentAgent()
    const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
    const scopeIds = [agent.id, ...getDownlineIds(allAgents, agent.id)]
    allowed = canAccessPolicy({ role: 'AGENT', agentScopeIds: scopeIds }, policy)
  }
  if (!allowed) notFound()

  // The carrier's own commission transactions and documents for this policy.
  // CommissionRecord requires a local policyId and covers fewer than half the
  // transactions, so a policy that plainly earned commission was reporting
  // "nenhuma comissão registrada". These rows are already in the database.
  let carrierCommissions: Array<{
    id: string
    agentName: string
    typeLabel: string
    level: number
    period: string
    amount: number
  }> = []
  let carrierDocuments: Array<{ id: string; date: string; type: string }> = []
  let serviceEvents: ClientServiceEvent[] = []

  // Every policy in the book is National Life today, so this reads as a
  // formality. It is not: the carrier rows are matched on policy number alone,
  // and a second insurer numbering a contract the same way would put its
  // client's service calls on this screen.
  const isCarrierNationalLife = /national life/i.test(policy.carrier ?? '')

  if (getNationalLifeLocalConnectorConfig().enabled && isCarrierNationalLife && policy.policyNumber) {
    const scopeId = LOCAL_CONNECTOR_DEPLOYMENT_SCOPE
    const [commissionRows, documentRows, serviceRows] = await Promise.all([
      prisma.nationalLifeReportRow.findMany({
        where: {
          deploymentScope: scopeId,
          gridKey: 'COMMISSION_DETAIL_NLD_COMMISSION_EARNING',
          raw: { path: ['PolicyNumber'], equals: policy.policyNumber },
        },
        select: { id: true, raw: true, amounts: true },
      }),
      prisma.nationalLifeReportRow.findMany({
        where: {
          deploymentScope: scopeId,
          gridKey: 'CORRESPONDENCE',
          // Correspondence pads the number with a leading `00` and no other
          // grid does, so matching only our own spelling found nothing: this
          // section rendered empty for every policy, which reads as a policy
          // with no documents.
          OR: carrierPolicyNumberVariants(policy.policyNumber).map((value) => ({
            raw: { path: ['RefPolicyNumber'], equals: value },
          })),
        },
        select: { id: true, raw: true },
      }),
      // Every time this client touched the carrier. It is also the only grid
      // that carries an email or a phone number — the inforce book returns
      // those columns null for every policy it has.
      prisma.nationalLifeReportRow.findMany({
        where: {
          deploymentScope: scopeId,
          gridKey: 'CLIENT_INTELLIGENCE',
          raw: { path: ['PolicyNumber'], equals: policy.policyNumber },
        },
        select: { id: true, raw: true },
      }),
    ])

    carrierCommissions = toCarrierCommissionRecords(commissionRows)
      .map((record) => ({
        id: record.id,
        agentName: record.writingAgentName || '—',
        typeLabel: record.type === 'DIRECT' ? 'Direta' : 'Repasse da equipe',
        level: record.level,
        period: record.period,
        amount: record.amount,
      }))
      .sort((left, right) => right.period.localeCompare(left.period))

    carrierDocuments = documentRows.map((row) => {
      const raw = (row.raw ?? {}) as Record<string, unknown>
      // These fields arrive as rendered anchors, so the label has to be pulled
      // out of the markup rather than printed as-is.
      const text = (value: unknown) =>
        typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''
      return {
        id: row.id,
        date: text(raw.DocumentDate) || '—',
        type: text(raw.DocumentType) || text(raw.DocumentCategory) || 'Documento',
      }
    })

    serviceEvents = toClientServiceEvents(serviceRows)
  }

  const atRiskEvents = serviceEvents.filter((event) => event.signal === 'AT_RISK')
  // The most recent contact detail the carrier has, which is more than the
  // inforce book ever returns for this policy.
  const carrierContact = {
    email: serviceEvents.find((event) => event.email)?.email ?? null,
    phone: serviceEvents.find((event) => event.phone)?.phone ?? null,
  }

  const policyDocuments = policy.documents.filter((doc) => !doc.storedPath.includes('/illustrations/'))
  const illustrationDocuments = policy.documents.filter((doc) => doc.storedPath.includes('/illustrations/'))
  const premium = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(policy.premium))

  const rawIllustrationRequestUrl = process.env.ILLUSTRATION_REQUEST_URL
  let illustrationRequestUrl: string | null = null
  if (rawIllustrationRequestUrl) {
    try {
      const u = new URL(rawIllustrationRequestUrl)
      u.searchParams.set('policyId', policy.id)
      u.searchParams.set('policyNumber', policy.policyNumber)
      u.searchParams.set('carrier', policy.carrier)
      u.searchParams.set('product', policy.product)
      illustrationRequestUrl = u.toString()
    } catch {
      illustrationRequestUrl = null
    }
  }

  return (
    <Shell role={session.user.role as 'ADMIN' | 'AGENT'} userName={session.user.name}>
      <PageHeader
        title={policy.policyNumber}
        eyebrow="Detalhe da apólice"
        description={`Contrato de ${policy.client.name} com documentos, revisão e comissão organizados em uma única visão.`}
      >
        <Link
          href="/agent/policies"
          className="module-detail-back"
          aria-label="Voltar para a lista de apólices"
        >
          <span className="module-detail-back-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none">
              <path d="m11.75 5.25-4.5 4.75 4.5 4.75M7.5 10h7.25" />
            </svg>
          </span>
          <span>Voltar para apólices</span>
        </Link>
      </PageHeader>

      <ModuleSummary
        label={`Resumo da apólice ${policy.policyNumber}`}
        items={[
          { label: 'Seguradora', value: policy.carrier, detail: 'Companhia responsável pelo contrato', compact: true },
          { label: 'Produto', value: policy.product, detail: 'Solução vinculada à apólice', compact: true },
          { label: 'Prêmio', value: premium, detail: 'Valor registrado no contrato', tone: 'green' },
          { label: 'Status', value: policyStatusLabel[policy.status] ?? policy.status, detail: 'Situação atual da cobertura', compact: true },
        ]}
      />

      {/* The carrier says a client is trying to leave long before the status
          column changes, and it says so here and nowhere else. Above the fold
          because a surrender request read next week is a lost policy. */}
      {atRiskEvents.length > 0 && (
        <section className="module-main-surface border-l-2 border-danger">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-danger">
            Atenção
          </p>
          <h2 className="mb-4 mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
            {atRiskEvents.length === 1
              ? 'A seguradora registrou um sinal de risco nesta apólice'
              : `A seguradora registrou ${atRiskEvents.length} sinais de risco nesta apólice`}
          </h2>
          <ul className="space-y-3">
            {atRiskEvents.slice(0, 5).map((event) => (
              <li key={event.id} className="border-t border-border-steel pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{event.reason ?? 'Contato'}</p>
                  <p className="text-xs text-ink-muted">
                    {event.occurredAt
                      ? event.occurredAt.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
                      : 'sem data'}
                    {event.category ? ` • ${event.category}` : ''}
                  </p>
                </div>
                {event.description && (
                  <p className="mt-1 line-clamp-3 text-sm text-ink-muted">{event.description}</p>
                )}
              </li>
            ))}
          </ul>
          {(carrierContact.phone || carrierContact.email) && (
            <p className="mt-4 border-t border-border-steel pt-3 text-sm text-ink-muted">
              Contato registrado na seguradora:{' '}
              {[carrierContact.phone, carrierContact.email].filter(Boolean).join(' • ')}
            </p>
          )}
        </section>
      )}

      <div className="module-content-grid">
        <section className="module-main-surface">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Resultado financeiro</p>
          <h2 className="mb-5 mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">Comissão gerada por esta apólice</h2>
          <Table>
            <Thead>
              <tr>
                <Th>Agente</Th>
                <Th>Tipo</Th>
                <Th>Nível</Th>
                <Th>Período</Th>
                <Th className="text-right">Valor</Th>
              </tr>
            </Thead>
            <tbody>
              {policy.commissionRecords.map((record, i) => (
                <Tr key={record.id} index={i}>
                  <Td>{record.agent.user.name}</Td>
                  <Td>{record.type === 'DIRECT' ? 'Direta' : 'Repasse da equipe'}</Td>
                  <Td className="text-ink-muted">{record.level}</Td>
                  <Td className="font-mono">{record.period}</Td>
                  <TdNum>${record.amount.toString()}</TdNum>
                </Tr>
              ))}
              {carrierCommissions.map((record, i) => (
                <Tr key={record.id} index={policy.commissionRecords.length + i}>
                  <Td>{record.agentName}</Td>
                  <Td>{record.typeLabel}</Td>
                  <Td className="text-ink-muted">{record.level}</Td>
                  <Td className="font-mono">{record.period}</Td>
                  <TdNum>${record.amount.toFixed(2)}</TdNum>
                </Tr>
              ))}
            </tbody>
          </Table>
          {policy.commissionRecords.length === 0 && carrierCommissions.length === 0 && (
            <EmptyState>Nenhuma comissão registrada ainda.</EmptyState>
          )}

          {serviceEvents.length > 0 && (
            <div className="mt-8 border-t border-border-steel pt-6">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
                Registrado pela seguradora
              </p>
              <h2 className="mb-5 mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
                Histórico de atendimento
              </h2>
              <Table>
                <Thead>
                  <tr>
                    <Th>Data</Th>
                    <Th>Motivo</Th>
                    <Th>Categoria</Th>
                    <Th>Atendente</Th>
                  </tr>
                </Thead>
                <tbody>
                  {serviceEvents.slice(0, 25).map((event) => (
                    <Tr key={event.id}>
                      <Td>
                        {event.occurredAt
                          ? event.occurredAt.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
                          : '—'}
                      </Td>
                      <Td>
                        <span className={event.signal === 'AT_RISK' ? 'text-danger' : undefined}>
                          {event.reason ?? '—'}
                        </span>
                      </Td>
                      <Td>{event.category ?? '—'}</Td>
                      <Td>{event.agentName ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {serviceEvents.length > 25 && (
                <p className="mt-3 text-xs text-ink-muted">
                  Mostrando os 25 atendimentos mais recentes de {serviceEvents.length}.
                </p>
              )}
            </div>
          )}
        </section>
        <aside className="space-y-4 lg:sticky lg:top-[5.75rem]">
          <section className="module-main-surface">
            <h2 className="text-base font-semibold text-ink">Cliente</h2>
            <p className="mt-2 text-sm text-ink">{policy.client.name}</p>
            {policy.client.email && <p className="mt-1 text-xs text-ink-muted">{policy.client.email}</p>}
            {/* Falling back rather than duplicating: the carrier's contact is
                only worth showing when we do not already have our own. */}
            {!policy.client.email && carrierContact.email && (
              <p className="mt-1 text-xs text-ink-muted">
                {carrierContact.email} <span className="text-ink-muted/70">— via National Life</span>
              </p>
            )}
            {carrierContact.phone && (
              <p className="mt-1 text-xs text-ink-muted">{carrierContact.phone}</p>
            )}
          </section>

          {/* An empty premium field reads as a bug the agent should report. The
              inforce book returns these columns null for all 9,614 policies, in
              every status and product class, so the screen says so instead of
              leaving a blank.

              Gated on this being a National Life policy: on anyone else's it
              would be a claim about an insurer we never asked. */}
          {isCarrierNationalLife && (
            <section className="module-main-surface">
              <h2 className="text-base font-semibold text-ink">
                O que a National Life não fornece
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                Capital segurado e prêmio por apólice não vêm do portal — as colunas existem no
                relatório da seguradora e chegam vazias. O prêmio no resumo acima é o registrado
                aqui, não o da seguradora.
              </p>
            </section>
          )}
          <AnnualReviewCard
            policyId={policy.id}
            reviews={policy.reviews.map((r) => ({
              id: r.id,
              dueAt: r.dueAt.toISOString(),
              completedAt: r.completedAt ? r.completedAt.toISOString() : null,
              notes: r.notes,
            }))}
          />
          <section className="module-main-surface">
            <h2 className="mb-3 text-base font-semibold text-ink">Documentos</h2>
            <ul className="divide-y divide-border-steel rounded-md border border-border-steel bg-panel">
              {policyDocuments.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <a href={`/api/documents/${doc.id}`} target="_blank" className="text-teal hover:text-teal-deep">
                    {doc.filename}
                  </a>
                  <span className="text-ink-muted">{(doc.sizeBytes / 1024).toFixed(0)} KB</span>
                </li>
              ))}
            </ul>
            {carrierDocuments.length > 0 && (
              <>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  Na National Life
                </p>
                <ul className="mt-2 divide-y divide-border-steel rounded-md border border-border-steel bg-panel">
                  {carrierDocuments.map((doc) => (
                    <li key={doc.id} className="px-4 py-2.5 text-sm">
                      <span className="text-ink">{doc.type}</span>
                      <span className="ml-2 text-xs text-ink-muted">{doc.date}</span>
                    </li>
                  ))}
                </ul>
                {/* Listed, not downloadable: the file lives at the carrier behind
                    an EncryptedDocumentHandle and fetching it is a separate
                    decision about volume and storage. Showing that it exists is
                    still better than claiming there is nothing. */}
                <p className="mt-2 text-xs text-ink-muted">
                  Disponíveis no portal da seguradora. Ainda não baixados para cá.
                </p>
              </>
            )}
            {policyDocuments.length === 0 && carrierDocuments.length === 0 && (
              <EmptyState>Nenhum documento ainda.</EmptyState>
            )}

            <PolicyUploadForm
              policyId={policy.id}
              documentKind="DOCUMENT"
              label="Enviar documento"
              pendingLabel="Enviando…"
            />
          </section>
          <section className="module-main-surface">
            <h2 className="mb-3 text-base font-semibold text-ink">Ilustrações</h2>
            <p className="mb-4 text-sm text-ink-muted">
              Aqui ficam as ilustrações vinculadas à apólice para consulta do time.
            </p>
            <ul className="divide-y divide-border-steel rounded-md border border-border-steel bg-panel">
              {illustrationDocuments.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <a href={`/api/documents/${doc.id}`} target="_blank" className="text-teal hover:text-teal-deep">
                    {doc.filename}
                  </a>
                  <span className="text-ink-muted">{(doc.sizeBytes / 1024).toFixed(0)} KB</span>
                </li>
              ))}
            </ul>
            {illustrationDocuments.length === 0 && <EmptyState>Nenhuma ilustração anexada ainda.</EmptyState>}

            <PolicyUploadForm
              policyId={policy.id}
              documentKind="ILLUSTRATION"
              label="Enviar ilustração"
              pendingLabel="Enviando…"
            />
            <div className="mt-4">
              {illustrationRequestUrl ? (
                <a
                  href={illustrationRequestUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-[background-color,border-color,color,transform] duration-150 hover:border-teal hover:bg-teal-pale/40 focus-visible:ring-[3px] focus-visible:ring-teal-pale focus-visible:outline-none"
                >
                  Solicitar ilustração no parceiro
                </a>
              ) : (
                <p className="text-xs text-ink-muted">
                  Configure <span className="font-mono">ILLUSTRATION_REQUEST_URL</span> no ambiente para ativar o botão de solicitação.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </Shell>
  )
}
