export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/Table'
import { EntityCard, EntityCardList } from '@/components/EntityCard'
import { ContextPanel } from '@/components/ContextPanel'
import { getServerI18n } from '@/lib/i18n/server'
import { formatCurrency, formatNumber } from '@/lib/i18n/format'
import { LocalizedPolicyStatusPill } from './LocalizedPolicyStatusPill'

export default async function ClientPortalPage() {
  const session = await requireRole('CLIENT', 'ADMIN')
  const { copy, language } = await getServerI18n()

  const client = await prisma.client.findUnique({ where: { userId: session.user.id } })
  if (!client) {
    return (
      <Shell role="CLIENT" userName={session.user.name}>
        <PageHeader title={copy('Minhas apólices', 'My policies')} eyebrow={copy('Minha conta', 'My account')} description={copy('Não encontramos uma conta de cliente vinculada a este login. Fale com seu agente para verificar seu cadastro.', "We couldn't find a client account linked to this login. Contact your agent to verify your registration.")} />
      </Shell>
    )
  }

  const policies = await prisma.policy.findMany({ where: { clientId: client.id } })

  return (
    <Shell role="CLIENT" userName={session.user.name}>
      <PageHeader title={copy('Minhas apólices', 'My policies')} eyebrow={copy('Minha conta', 'My account')} description={copy('Consulte suas apólices, status e documentos em um só lugar.', 'View your policies, status, and documents in one place.')}>
        <span className="inline-flex rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal">{policies.length === 1 ? copy('1 apólice', '1 policy') : copy(`${formatNumber(policies.length, language)} apólices`, `${formatNumber(policies.length, language)} policies`)}</span>
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
                {policy.premium === null ? '—' : formatCurrency(policy.premium.toNumber(), language, 'USD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <LocalizedPolicyStatusPill status={policy.status} language={language} />
            </EntityCard>
          ))}
        </EntityCardList>
        {policies.length === 0 && (
          <EmptyState>
            {copy('Nenhuma apólice encontrada. Se você acredita que isso é um erro, fale com seu agente.', 'No policies were found. If you believe this is an error, contact your agent.')}
          </EmptyState>
        )}
      </div>
      <ContextPanel eyebrow={copy('Sua conta', 'Your account')} title={copy('Tudo em um lugar', 'Everything in one place')}>
        <p>{copy('Acompanhe o status das suas apólices e abra qualquer item para acessar os documentos disponíveis.', 'Track the status of your policies and open any item to access its available documents.')}</p>
      </ContextPanel>
      </div>
    </Shell>
  )
}
