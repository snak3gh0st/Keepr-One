export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { canAccessPolicy } from '@/lib/policy-access'
import { Shell } from '@/components/Shell'
import { PageTitle } from '@/components/PageTitle'
import { PolicyStatusPill } from '@/components/StatusPill'
import { EmptyState } from '@/components/Table'

export default async function ClientPolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireRole('CLIENT', 'ADMIN')

  const policy = await prisma.policy.findUnique({
    where: { id },
    include: { documents: true },
  })
  if (!policy) notFound()

  let allowed = session.user.role === 'ADMIN'
  if (session.user.role === 'CLIENT') {
    const client = await prisma.client.findUnique({ where: { userId: session.user.id } })
    if (!client) notFound()
    allowed = canAccessPolicy({ role: 'CLIENT', clientId: client.id }, policy)
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
    <Shell role="CLIENT" userName={session.user.name}>
      <Link href="/client" className="text-sm font-semibold text-teal hover:text-teal-deep">
        ← Voltar
      </Link>
      <div className="mt-3 border-b border-border-steel pb-6">
        <PageTitle>Apólice {policy.policyNumber}</PageTitle>
        <p className="mt-2 text-sm text-ink-muted">Resumo da sua cobertura e documentos disponíveis.</p>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-steel bg-border-steel sm:grid-cols-4">
        <div className="bg-panel px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Seguradora</p>
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

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section>
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

          <h2 className="mb-3 mt-8 text-base font-semibold text-ink">Ilustrações</h2>
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
        <aside className="rounded-md border border-border-steel bg-rail p-5 text-paper">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-paper/45">Sua cobertura</p>
          <h2 className="mt-2 text-base font-semibold">Informações principais</h2>
          <p className="mt-4 text-sm leading-6 text-paper/65">
            Use os dados acima para confirmar a seguradora, o produto, o prêmio e o status atual da apólice.
          </p>
        </aside>
      </div>
    </Shell>
  )
}
