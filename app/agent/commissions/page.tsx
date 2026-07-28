import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { decimalToNumber } from '@/lib/decimal'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/ErrorBanner'
import { ContextPanel } from '@/components/ContextPanel'
import { ModuleSummary } from '@/components/ModuleSummary'
import { CommissionsList } from './CommissionsList'

export const dynamic = 'force-dynamic'

type Record_ = {
  id: string
  period: string
  type: string
  level: number
  amount: unknown
  policy: { id: string; policyNumber: string; agent: { user: { name: string } } } | null
}

export default async function CommissionsPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  let records: Record_[] = []
  let loadError = false

  try {
    records = await prisma.commissionRecord.findMany({
      where: { agentId: agent.id },
      include: { policy: { include: { agent: { include: { user: true } } } } },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
    })
  } catch (error) {
    console.error('Commissions query error', error)
    loadError = true
  }

  const periods = Array.from(new Set(records.map((r) => r.period)))
  const byPeriod = periods.map((period) => {
    const rows = records.filter((r) => r.period === period)
    const subtotal = rows.reduce((sum, r) => sum + decimalToNumber(r.amount), 0)
    return { period, rows, subtotal }
  })
  const totalAmount = records.reduce((sum, record) => sum + decimalToNumber(record.amount), 0)
  const directAmount = records
    .filter((record) => record.type === 'DIRECT')
    .reduce((sum, record) => sum + decimalToNumber(record.amount), 0)
  const overrideAmount = totalAmount - directAmount

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader title="Comissões" eyebrow="Resultado financeiro" description="Entenda quanto veio da sua produção, quanto veio da equipe e qual apólice originou cada lançamento.">
        <Link
          href="/agent/policies"
          className="inline-flex items-center border border-white/20 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/10"
        >
          Ver apólices
        </Link>
        <span className="inline-flex rounded-full bg-gold-pale px-3 py-1.5 text-xs font-semibold text-gold-ink">{records.length} lançamentos</span>
      </PageHeader>
      {loadError && (
        <ErrorBanner>
          Não foi possível carregar seu extrato agora. Tente atualizar a página.
        </ErrorBanner>
      )}

      {!loadError && (
        <ModuleSummary
          label="Resumo das comissões"
          items={[
            { label: 'Total registrado', value: `$${totalAmount.toFixed(0)}`, detail: `${periods.length} período(s) com movimento`, tone: 'green' },
            { label: 'Produção direta', value: `$${directAmount.toFixed(0)}`, detail: 'Comissão das suas próprias vendas' },
            { label: 'Produção da equipe', value: `$${overrideAmount.toFixed(0)}`, detail: 'Repasses gerados pela sua equipe', tone: 'gold' },
          ]}
        />
      )}

      <div className="module-content-grid">
      <section className="min-w-0">
        {!loadError && (
          <CommissionsList
            byPeriod={byPeriod.map(({ period, rows, subtotal }) => ({
              period,
              subtotal: subtotal.toFixed(2),
              rows: rows.map((record) => ({
                id: record.id,
                policyNumber: record.policy?.policyNumber ?? null,
                policyId: record.policy?.id ?? null,
                agentName: record.policy?.agent.user.name ?? '—',
                typeLabel: record.type === 'DIRECT' ? 'Direta' : 'Repasse',
                level: record.level,
                amount: decimalToNumber(record.amount).toFixed(2),
              })),
            }))}
          />
        )}
      </section>
      <ContextPanel eyebrow="Continue por aqui" title="Origem de cada resultado">
        <p>Cada lançamento mostra o período, a origem da venda e o nível da comissão dentro da sua hierarquia.</p>
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Nível 0</p>
          <p className="mt-2">Venda direta feita por você.</p>
        </div>
      </ContextPanel>
      </div>
    </Shell>
  )
}
