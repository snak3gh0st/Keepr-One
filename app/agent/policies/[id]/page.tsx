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
import { PageTitle } from '@/components/PageTitle'
import { PolicyStatusPill } from '@/components/StatusPill'
import { Table, Thead, Th, Tr, Td, TdNum, EmptyState } from '@/components/Table'

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

  const policyDocuments = policy.documents.filter((doc) => !doc.storedPath.includes('/illustrations/'))
  const illustrationDocuments = policy.documents.filter((doc) => doc.storedPath.includes('/illustrations/'))

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
      <Link href="/agent/policies" className="text-sm font-semibold text-teal hover:text-teal-deep">
        ← Voltar
      </Link>
      <div className="mt-3 border-b border-border-steel pb-6">
        <PageTitle>Apólice {policy.policyNumber}</PageTitle>
        <p className="mt-2 text-sm text-ink-muted">Detalhes da apólice e comissões geradas.</p>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-steel bg-border-steel sm:grid-cols-4">
        <div className="bg-panel px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Carrier</p>
          <p className="text-sm text-ink">{policy.carrier}</p>
        </div>
        <div className="bg-panel px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Produto</p>
          <p className="text-sm text-ink">{policy.product}</p>
        </div>
        <div className="bg-panel px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Prêmio</p>
          <p className="font-mono text-sm text-ink">${policy.premium.toString()}</p>
        </div>
        <div className="bg-panel px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Status</p>
          <PolicyStatusPill status={policy.status} />
        </div>
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">Comissão gerada por esta apólice</h2>
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
                  <Td>{record.type === 'DIRECT' ? 'Direta' : 'Override'}</Td>
                  <Td className="text-ink-muted">{record.level}</Td>
                  <Td className="font-mono">{record.period}</Td>
                  <TdNum>${record.amount.toString()}</TdNum>
                </Tr>
              ))}
            </tbody>
          </Table>
          {policy.commissionRecords.length === 0 && <EmptyState>Nenhuma comissão registrada ainda.</EmptyState>}
        </section>
        <aside className="space-y-5 lg:sticky lg:top-6">
          <section className="rounded-md border border-border-steel bg-paper p-5">
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
          <section className="rounded-md border border-border-steel bg-paper p-5">
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
            {policyDocuments.length === 0 && <EmptyState>Nenhum documento ainda.</EmptyState>}

            <PolicyUploadForm
              policyId={policy.id}
              documentKind="DOCUMENT"
              label="Enviar documento"
              pendingLabel="Enviando…"
            />
          </section>
          <section className="rounded-md border border-border-steel bg-paper p-5">
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
