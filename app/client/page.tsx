export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/Table'
import { EntityCard, EntityCardList } from '@/components/EntityCard'
import { PolicyStatusPill } from '@/components/StatusPill'
import { ContextPanel } from '@/components/ContextPanel'

export default async function ClientPortalPage() {
  const session = await requireRole('CLIENT', 'ADMIN')

  const client = await prisma.client.findUnique({ where: { userId: session.user.id } })
  if (!client) {
    return (
      <Shell role="CLIENT" userName={session.user.name}>
        <PageHeader title="Minhas apólices" eyebrow="Minha conta" description="Não encontramos uma conta de cliente vinculada a este login. Fale com seu agente para verificar seu cadastro." />
      </Shell>
    )
  }

  const policies = await prisma.policy.findMany({ where: { clientId: client.id } })

  return (
    <Shell role="CLIENT" userName={session.user.name}>
      <PageHeader title="Minhas apólices" eyebrow="Minha conta" description="Consulte suas apólices, status e documentos em um só lugar.">
        <span className="inline-flex rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal">{policies.length} apólices</span>
      </PageHeader>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="max-w-5xl">
        <EntityCardList>
          {policies.map((policy, i) => (
            <EntityCard key={policy.id} index={i} href={`/client/policies/${policy.id}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{policy.carrier}</p>
                <p className="truncate text-xs text-ink-muted">
                  {policy.product} · <span className="font-mono">{policy.policyNumber}</span>
                </p>
              </div>
              <span className="shrink-0 font-mono font-medium tabular-nums text-ink">
                {policy.premium === null ? '—' : `$${policy.premium.toString()}`}
              </span>
              <PolicyStatusPill status={policy.status} />
            </EntityCard>
          ))}
        </EntityCardList>
        {policies.length === 0 && (
          <EmptyState>
            Nenhuma apólice encontrada. Se você acredita que isso é um erro, fale com seu agente.
          </EmptyState>
        )}
      </div>
      <ContextPanel eyebrow="Sua conta" title="Tudo em um lugar">
        <p>Acompanhe o status das suas apólices e abra qualquer item para acessar os documentos disponíveis.</p>
      </ContextPanel>
      </div>
    </Shell>
  )
}
