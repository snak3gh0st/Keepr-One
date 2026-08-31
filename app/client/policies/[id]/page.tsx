export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { canAccessPolicy } from '@/lib/policy-access'
import { Shell } from '@/components/Shell'
import { PageTitle } from '@/components/PageTitle'
import { EmptyState } from '@/components/Table'
import { getServerI18n } from '@/lib/i18n/server'
import { formatCurrency, formatNumber } from '@/lib/i18n/format'
import { LocalizedPolicyStatusPill } from '../../LocalizedPolicyStatusPill'

export default async function ClientPolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireRole('CLIENT', 'ADMIN')
  const { copy, language } = await getServerI18n()

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
        ← {copy('Voltar', 'Back')}
      </Link>
      <div className="mt-3 border-b border-border-steel pb-6">
        <PageTitle>{copy('Apólice', 'Policy')} {policy.policyNumber}</PageTitle>
        <p className="mt-2 text-sm text-ink-muted">{copy('Resumo da sua cobertura e documentos disponíveis.', 'Summary of your coverage and available documents.')}</p>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-steel bg-border-steel sm:grid-cols-4">
        <div className="bg-panel px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{copy('Seguradora', 'Carrier')}</p>
          <p className="text-sm text-ink">{policy.carrier}</p>
        </div>
        <div className="bg-panel px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{copy('Produto', 'Product')}</p>
          <p className="text-sm text-ink">{policy.product}</p>
        </div>
        <div className="bg-panel px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{copy('Prêmio', 'Premium')}</p>
          <p className="font-mono text-sm text-ink">
            {policy.premium === null
              ? copy('Não informado pela seguradora', 'Not provided by the carrier')
              : formatCurrency(policy.premium.toNumber(), language, 'USD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-panel px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Status</p>
          <LocalizedPolicyStatusPill status={policy.status} language={language} />
        </div>
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">{copy('Documentos', 'Documents')}</h2>
          <ul className="divide-y divide-border-steel rounded-md border border-border-steel bg-panel">
            {policyDocuments.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <a href={`/api/documents/${doc.id}`} target="_blank" className="text-teal hover:text-teal-deep">
                  {doc.filename}
                </a>
                <span className="text-ink-muted">{formatNumber(doc.sizeBytes / 1024, language, { maximumFractionDigits: 0 })} KB</span>
              </li>
            ))}
          </ul>
          {policyDocuments.length === 0 && <EmptyState>{copy('Nenhum documento ainda.', 'No documents yet.')}</EmptyState>}

          <h2 className="mb-3 mt-8 text-base font-semibold text-ink">{copy('Ilustrações', 'Illustrations')}</h2>
          <ul className="divide-y divide-border-steel rounded-md border border-border-steel bg-panel">
            {illustrationDocuments.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <a href={`/api/documents/${doc.id}`} target="_blank" className="text-teal hover:text-teal-deep">
                  {doc.filename}
                </a>
                <span className="text-ink-muted">{formatNumber(doc.sizeBytes / 1024, language, { maximumFractionDigits: 0 })} KB</span>
              </li>
            ))}
          </ul>
          {illustrationDocuments.length === 0 && <EmptyState>{copy('Nenhuma ilustração anexada ainda.', 'No illustrations have been attached yet.')}</EmptyState>}
          <div className="mt-4">
            {illustrationRequestUrl ? (
              <a
                href={illustrationRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-[background-color,border-color,color,transform] duration-150 hover:border-teal hover:bg-teal-pale/40 focus-visible:ring-[3px] focus-visible:ring-teal-pale focus-visible:outline-none"
              >
                {copy('Solicitar ilustração no parceiro', 'Request an illustration from our partner')}
              </a>
            ) : (
              <p className="text-xs text-ink-muted">
                {copy('Configure', 'Set')} <span className="font-mono">ILLUSTRATION_REQUEST_URL</span> {copy('no ambiente para ativar o botão de solicitação.', 'in the environment to enable the request button.')}
              </p>
            )}
          </div>
        </section>
        <aside className="rounded-md border border-border-steel bg-rail p-5 text-paper">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-paper/45">{copy('Sua cobertura', 'Your coverage')}</p>
          <h2 className="mt-2 text-base font-semibold">{copy('Informações principais', 'Key information')}</h2>
          <p className="mt-4 text-sm leading-6 text-paper/65">
            {copy('Use os dados acima para confirmar a seguradora, o produto, o prêmio e o status atual da apólice.', 'Use the information above to confirm the carrier, product, premium, and current policy status.')}
          </p>
        </aside>
      </div>
    </Shell>
  )
}
