export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { canAccessPolicy } from '@/lib/policy-access'
import { AnnualReviewCard } from './AnnualReviewCard'
import { NationalLifeDocumentButton } from './NationalLifeDocumentButton'
import { PolicyUploadForm } from './PolicyUploadForm'
import { NationalLifePolicyDetailCard } from './NationalLifePolicyDetailCard'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { policyStatusLabel } from '@/components/StatusPill'
import { Table, Thead, Th, Tr, Td, TdNum, EmptyState } from '@/components/Table'
import { ModuleSummary } from '@/components/ModuleSummary'
import {
  toClientServiceEvents,
  type ClientServiceEvent,
} from '@/lib/national-life/client-intelligence'
import {
  preferCanonicalCarrierCommissionRows,
  toCarrierCommissionRecords,
} from '@/lib/national-life/commission-records'
import { carrierPolicyNumberVariants } from '@/lib/national-life/policy-number'
import {
  COMMISSION_EARNING_GRID_KEYS,
  LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE,
  LEGACY_COMMISSION_EARNING_GRID_KEY,
} from '@/lib/national-life/commission-grid-keys'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { getServerI18n } from '@/lib/i18n/server'
import { localeFor } from '@/lib/i18n/config'

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { copy, language } = await getServerI18n()
  const locale = localeFor(language)
  const { id } = await params
  const session = await requireRole('ADMIN', 'AGENT')

  const policy = await prisma.policy.findUnique({
    where: { id },
    include: {
      client: true,
      commissionRecords: { include: { agent: { include: { user: true } } }, orderBy: { createdAt: 'desc' } },
      documents: true,
      reviews: { orderBy: { dueAt: 'desc' } },
      nationalLifeDetail: true,
    },
  })
  if (!policy) notFound()

  let allowed = session.user.role === 'ADMIN'
  let agentScopeIds: string[] | null = null
  if (session.user.role === 'AGENT') {
    const agent = await getCurrentAgent()
    agentScopeIds = await getAgentScopeIds(agent.id)
    allowed = canAccessPolicy({ role: 'AGENT', agentScopeIds }, policy)
  }
  if (!allowed) notFound()

  const visibleCommissionRecords = agentScopeIds
    ? policy.commissionRecords.filter((record) => agentScopeIds.includes(record.agentId))
    : policy.commissionRecords

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
  let carrierDocuments: Array<{
    id: string
    date: string
    type: string
    storedDocumentId: string | null
  }> = []
  let serviceEvents: ClientServiceEvent[] = []
  let serviceSourceUpdatedAt: Date | null = null

  // Every policy in the book is National Life today, so this reads as a
  // formality. It is not: the carrier rows are matched on policy number alone,
  // and a second insurer numbering a contract the same way would put its
  // client's service calls on this screen.
  const isCarrierNationalLife = /national life/i.test(policy.carrier ?? '')

  const localConnector = getNationalLifeLocalConnectorConfig()
  if (localConnector.enabled && isCarrierNationalLife && policy.policyNumber) {
    const scopeId = LOCAL_CONNECTOR_DEPLOYMENT_SCOPE
    const [commissionRows, documentRows, serviceRows] = await Promise.all([
      prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: policy.agentId,
          OR: [
            {
              deploymentScope: scopeId,
              gridKey: { in: [...COMMISSION_EARNING_GRID_KEYS] },
            },
            {
              deploymentScope: LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE,
              gridKey: LEGACY_COMMISSION_EARNING_GRID_KEY,
            },
          ],
          raw: { path: ['PolicyNumber'], equals: policy.policyNumber },
        },
        select: {
          id: true,
          agentId: true,
          deploymentScope: true,
          raw: true,
          amounts: true,
        },
      }),
      prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: policy.agentId,
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
        select: { id: true, raw: true, fetchedAt: true },
      }),
      // Every time this client touched the carrier. It is also the only grid
      // that carries an email or a phone number — the inforce book returns
      // those columns null for every policy it has.
      prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: policy.agentId,
          deploymentScope: scopeId,
          gridKey: 'CLIENT_INTELLIGENCE',
          raw: { path: ['PolicyNumber'], equals: policy.policyNumber },
        },
        select: { id: true, raw: true, fetchedAt: true },
      }),
    ])

    carrierCommissions = toCarrierCommissionRecords(
      preferCanonicalCarrierCommissionRows(commissionRows, scopeId),
    )
      .filter((record) => record.type === 'DIRECT')
      .map((record) => ({
        id: record.id,
        agentName: record.writingAgentName || '—',
        typeLabel: record.type === 'DIRECT' ? copy('Direta', 'Direct') : copy('Repasse da equipe', 'Team override'),
        level: record.level,
        period: record.period,
        amount: record.amount,
      }))
      .sort((left, right) => right.period.localeCompare(left.period))

    const storedBySourceRow = new Map(
      policy.documents
        .filter((document) => document.sourceRowId)
        .map((document) => [document.sourceRowId as string, document.id]),
    )
    carrierDocuments = documentRows.map((row) => {
      const raw = (row.raw ?? {}) as Record<string, unknown>
      // These fields arrive as rendered anchors, so the label has to be pulled
      // out of the markup rather than printed as-is.
      const text = (value: unknown) =>
        typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''
      return {
        id: row.id,
        date: text(raw.DocumentDate) || '—',
        type: text(raw.DocumentType) || text(raw.DocumentCategory) || copy('Documento', 'Document'),
        storedDocumentId: storedBySourceRow.get(row.id) ?? null,
      }
    })

    serviceEvents = toClientServiceEvents(serviceRows)
    serviceSourceUpdatedAt = serviceRows.reduce<Date | null>(
      (latest, row) => !latest || row.fetchedAt > latest ? row.fetchedAt : latest,
      null,
    )
  }

  const atRiskEvents = serviceEvents.filter((event) => event.signal === 'AT_RISK')
  // The most recent contact detail the carrier has, which is more than the
  // inforce book ever returns for this policy.
  const carrierContact = {
    email: serviceEvents.find((event) => event.email)?.email ?? null,
    phone: serviceEvents.find((event) => event.phone)?.phone ?? null,
  }

  const policyDocuments = policy.documents.filter(
    (doc) => !doc.storedPath.includes('/illustrations/') && doc.provider !== 'NATIONAL_LIFE',
  )
  const illustrationDocuments = policy.documents.filter((doc) => doc.storedPath.includes('/illustrations/'))
  const money = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
  })
  const premium = policy.premium === null ? '—' : money.format(Number(policy.premium))
  const carrierDetail = policy.nationalLifeDetail
    ? {
        totalFaceAmount: policy.nationalLifeDetail.totalFaceAmount?.toString() ?? null,
        netDeathBenefit: policy.nationalLifeDetail.netDeathBenefit?.toString() ?? null,
        plannedPeriodicPayment: policy.nationalLifeDetail.plannedPeriodicPayment?.toString() ?? null,
        paymentFrequency: policy.nationalLifeDetail.paymentFrequency,
        anticipatedAnnualPremium: policy.nationalLifeDetail.anticipatedAnnualPremium?.toString() ?? null,
        observedAt: policy.nationalLifeDetail.observedAt.toISOString(),
      }
    : null

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
        eyebrow={copy('Detalhe da apólice', 'Policy details')}
        description={copy('Contrato de {client} com documentos, revisão e comissão organizados em uma única visão.', '{client}’s contract with documents, reviews, and commissions organized in one view.', { client: policy.client.name })}
      >
        <Link
          href="/agent/policies"
          className="module-detail-back"
          aria-label={copy('Voltar para a lista de apólices', 'Back to policy list')}
        >
          <span className="module-detail-back-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none">
              <path d="m11.75 5.25-4.5 4.75 4.5 4.75M7.5 10h7.25" />
            </svg>
          </span>
          <span>{copy('Voltar para apólices', 'Back to policies')}</span>
        </Link>
      </PageHeader>

      <ModuleSummary
        label={copy('Resumo da apólice {number}', 'Policy {number} summary', { number: policy.policyNumber })}
        items={[
          { label: copy('Seguradora', 'Carrier'), value: policy.carrier, detail: copy('Companhia responsável pelo contrato', 'Company responsible for the contract'), compact: true },
          { label: copy('Produto', 'Product'), value: policy.product, detail: copy('Solução vinculada à apólice', 'Solution linked to the policy'), compact: true },
          { label: copy('Prêmio', 'Premium'), value: premium, detail: copy('Valor registrado no contrato', 'Amount recorded in the contract'), tone: 'green' },
          { label: copy('Status', 'Status'), value: language === 'PT' ? policyStatusLabel[policy.status] ?? policy.status : ({ INFORCE: 'In force', APPROVED: 'Approved', PENDING: 'Pending', LAPSED: 'Lapsed', CANCELLED: 'Cancelled' } as Record<string, string>)[policy.status] ?? policy.status, detail: copy('Situação atual da cobertura', 'Current coverage status'), compact: true },
        ]}
      />

      {/* The carrier says a client is trying to leave long before the status
          column changes, and it says so here and nowhere else. Above the fold
          because a surrender request read next week is a lost policy. */}
      {atRiskEvents.length > 0 && (
        <section className="module-main-surface border-l-2 border-danger">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-danger">
            {copy('Atenção', 'Attention')}
          </p>
          <h2 className="mb-4 mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
            {atRiskEvents.length === 1
              ? copy('A seguradora registrou um sinal de risco nesta apólice', 'The carrier recorded a risk signal for this policy')
              : copy('A seguradora registrou {count} sinais de risco nesta apólice', 'The carrier recorded {count} risk signals for this policy', { count: atRiskEvents.length })}
          </h2>
          {serviceSourceUpdatedAt && (
            <p className="mb-4 text-xs text-ink-muted">
              {copy('Fonte atualizada em', 'Source updated on')} {serviceSourceUpdatedAt.toLocaleString(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'America/New_York',
              })}.
            </p>
          )}
          <ul className="space-y-3">
            {atRiskEvents.slice(0, 5).map((event) => (
              <li key={event.id} className="border-t border-border-steel pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{event.reason ?? copy('Contato', 'Contact')}</p>
                  <p className="text-xs text-ink-muted">
                    {event.occurredAt
                      ? event.occurredAt.toLocaleDateString(locale, { timeZone: 'UTC' })
                      : copy('sem data', 'no date')}
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
              {copy('Contato registrado na seguradora:', 'Contact recorded by the carrier:')}{' '}
              {[carrierContact.phone, carrierContact.email].filter(Boolean).join(' • ')}
            </p>
          )}
        </section>
      )}

      <div className="module-content-grid">
        <section className="module-main-surface">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{copy('Resultado financeiro', 'Financial result')}</p>
          <h2 className="mb-5 mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">{copy('Comissão gerada por esta apólice', 'Commission generated by this policy')}</h2>
          <Table>
            <Thead>
              <tr>
                <Th>{copy('Agente', 'Agent')}</Th>
                <Th>{copy('Tipo', 'Type')}</Th>
                <Th>{copy('Nível', 'Level')}</Th>
                <Th>{copy('Período', 'Period')}</Th>
                <Th className="text-right">{copy('Valor', 'Amount')}</Th>
              </tr>
            </Thead>
            <tbody>
              {visibleCommissionRecords.map((record, i) => (
                <Tr key={record.id} index={i}>
                  <Td>{record.agent.user.name}</Td>
                  <Td>{record.type === 'DIRECT' ? copy('Direta', 'Direct') : copy('Repasse da equipe', 'Team override')}</Td>
                  <Td className="text-ink-muted">{record.level}</Td>
                  <Td className="font-mono">{record.period}</Td>
                  <TdNum>${record.amount.toString()}</TdNum>
                </Tr>
              ))}
              {carrierCommissions.map((record, i) => (
                <Tr key={record.id} index={visibleCommissionRecords.length + i}>
                  <Td>{record.agentName}</Td>
                  <Td>{record.typeLabel}</Td>
                  <Td className="text-ink-muted">{record.level}</Td>
                  <Td className="font-mono">{record.period}</Td>
                  <TdNum>${record.amount.toFixed(2)}</TdNum>
                </Tr>
              ))}
            </tbody>
          </Table>
          {visibleCommissionRecords.length === 0 && carrierCommissions.length === 0 && (
            <EmptyState>{copy('Nenhuma comissão registrada ainda.', 'No commissions recorded yet.')}</EmptyState>
          )}

          {serviceEvents.length > 0 && (
            <div className="mt-8 border-t border-border-steel pt-6">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
                {copy('Registrado pela seguradora', 'Recorded by the carrier')}
              </p>
              <h2 className="mb-5 mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
                {copy('Histórico de atendimento', 'Service history')}
              </h2>
              {serviceSourceUpdatedAt && (
                <p className="mb-4 text-xs text-ink-muted">
                  {copy('Fonte atualizada em', 'Source updated on')} {serviceSourceUpdatedAt.toLocaleString(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'America/New_York',
                  })}.
                </p>
              )}
              <Table>
                <Thead>
                  <tr>
                    <Th>{copy('Data', 'Date')}</Th>
                    <Th>{copy('Motivo', 'Reason')}</Th>
                    <Th>{copy('Categoria', 'Category')}</Th>
                    <Th>{copy('Atendente', 'Representative')}</Th>
                  </tr>
                </Thead>
                <tbody>
                  {serviceEvents.slice(0, 25).map((event) => (
                    <Tr key={event.id}>
                      <Td>
                        {event.occurredAt
                          ? event.occurredAt.toLocaleDateString(locale, { timeZone: 'UTC' })
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
                  {copy('Mostrando os 25 atendimentos mais recentes de {count}.', 'Showing the 25 most recent service events out of {count}.', { count: serviceEvents.length })}
                </p>
              )}
            </div>
          )}
        </section>
        <aside className="space-y-4 lg:sticky lg:top-[5.75rem]">
          <section className="module-main-surface">
            <h2 className="text-base font-semibold text-ink">{copy('Cliente', 'Client')}</h2>
            <p className="mt-2 text-sm text-ink">{policy.client.name}</p>
            {policy.client.email && <p className="mt-1 text-xs text-ink-muted">{policy.client.email}</p>}
            {/* Falling back rather than duplicating: the carrier's contact is
                only worth showing when we do not already have our own. */}
            {!policy.client.email && carrierContact.email && (
              <p className="mt-1 text-xs text-ink-muted">
                {carrierContact.email} <span className="text-ink-muted/70">— {copy('via National Life', 'via National Life')}</span>
              </p>
            )}
            {carrierContact.phone && (
              <p className="mt-1 text-xs text-ink-muted">{carrierContact.phone}</p>
            )}
          </section>

          {/* The bulk book and the per-policy detail are different carrier
              sources. Only the latter proves coverage/payment values, so the
              screen shows its own freshness instead of making a carrier-wide
              claim from an empty bulk column. */}
          {isCarrierNationalLife && (
            <NationalLifePolicyDetailCard
              detail={carrierDetail}
              refresh={localConnector.enabled
                ? { policyId: policy.id, extensionId: localConnector.extensionTarget }
                : undefined}
            />
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
            <h2 className="mb-3 text-base font-semibold text-ink">{copy('Documentos', 'Documents')}</h2>
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
                  {copy('Na National Life', 'At National Life')}
                </p>
                <ul className="mt-2 divide-y divide-border-steel rounded-md border border-border-steel bg-panel">
                  {carrierDocuments.map((doc) => (
                    <li key={doc.id} className="flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        <span className="block text-ink">{doc.type}</span>
                        <span className="text-xs text-ink-muted">{doc.date}</span>
                      </span>
                      {doc.storedDocumentId ? (
                        <a
                          href={`/api/documents/${doc.storedDocumentId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-teal hover:text-teal-deep"
                        >
                          {copy('Abrir na Keepr One', 'Open in Keepr One')}
                        </a>
                      ) : localConnector.enabled ? (
                        <NationalLifeDocumentButton
                          extensionId={localConnector.extensionTarget}
                          reportRowId={doc.id}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">
                  {copy('Os arquivos ficam na National Life até você pedir. Depois de validados, ficam disponíveis na Keepr One.', 'Files remain at National Life until you request them. After validation, they become available in Keepr One.')}
                </p>
              </>
            )}
            {policyDocuments.length === 0 && carrierDocuments.length === 0 && (
              <EmptyState>{copy('Nenhum documento ainda.', 'No documents yet.')}</EmptyState>
            )}

            <PolicyUploadForm
              policyId={policy.id}
              documentKind="DOCUMENT"
              label={copy('Enviar documento', 'Upload document')}
              pendingLabel={copy('Enviando…', 'Uploading…')}
            />
          </section>
          <section className="module-main-surface">
            <h2 className="mb-3 text-base font-semibold text-ink">{copy('Ilustrações', 'Illustrations')}</h2>
            <p className="mb-4 text-sm text-ink-muted">
              {copy('Aqui ficam as ilustrações vinculadas à apólice para consulta do time.', 'Illustrations linked to the policy are available here for the team to review.')}
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
            {illustrationDocuments.length === 0 && <EmptyState>{copy('Nenhuma ilustração anexada ainda.', 'No illustrations attached yet.')}</EmptyState>}

            <PolicyUploadForm
              policyId={policy.id}
              documentKind="ILLUSTRATION"
              label={copy('Enviar ilustração', 'Upload illustration')}
              pendingLabel={copy('Enviando…', 'Uploading…')}
            />
            <div className="mt-4">
              {illustrationRequestUrl ? (
                <a
                  href={illustrationRequestUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-[background-color,border-color,color,transform] duration-150 hover:border-teal hover:bg-teal-pale/40 focus-visible:ring-[3px] focus-visible:ring-teal-pale focus-visible:outline-none"
                >
                  {copy('Solicitar ilustração no parceiro', 'Request illustration from partner')}
                </a>
              ) : (
                <p className="text-xs text-ink-muted">
                  {copy('Configure', 'Configure')} <span className="font-mono">ILLUSTRATION_REQUEST_URL</span> {copy('no ambiente para ativar o botão de solicitação.', 'in the environment to enable the request button.')}
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </Shell>
  )
}
