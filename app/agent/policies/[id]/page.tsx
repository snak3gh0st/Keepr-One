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
import { toCarrierCommissionRecords } from '@/lib/national-life/commission-records'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'

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

  if (isNationalLifeConfigured() && policy.policyNumber) {
    const scopeId = getNationalLifeEnv().sessionScopeId
    const [commissionRows, documentRows] = await Promise.all([
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
          raw: { path: ['RefPolicyNumber'], equals: policy.policyNumber },
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
        <Link href="/agent/policies" className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper hover:bg-white/[0.06]">
          ← Voltar à carteira
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
        </section>
        <aside className="space-y-4 lg:sticky lg:top-[5.75rem]">
          <section className="module-main-surface">
            <h2 className="text-base font-semibold text-ink">Cliente</h2>
            <p className="mt-2 text-sm text-ink">{policy.client.name}</p>
            {policy.client.email && <p className="mt-1 text-xs text-ink-muted">{policy.client.email}</p>}
          </section>
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
