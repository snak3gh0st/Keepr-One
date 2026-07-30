import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { decimalToNumber } from '@/lib/decimal'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/ErrorBanner'
import { ContextPanel } from '@/components/ContextPanel'
import { ModuleSummary } from '@/components/ModuleSummary'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
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

/// The carrier's earning detail is one row per commission transaction, which is
/// the same shape this page already renders. It is read directly rather than
/// promoted into CommissionRecord because that table requires a Policy row and
/// only 2329 of 5408 transactions reference a policy in the current book — the
/// rest are policies that still pay renewals but are no longer inforce. Promoting
/// only the matching ones would silently show 43% of the agent's commission.
function toCommissionRecords(
  rows: Array<{ id: string; raw: unknown; amounts: unknown }>,
): Record_[] {
  return rows.flatMap((row) => {
    const raw = (row.raw ?? {}) as Record<string, unknown>
    const amounts = (row.amounts ?? {}) as Record<string, unknown>
    const gross = typeof amounts.GrossCommEarned === 'string' ? amounts.GrossCommEarned : null
    if (!gross) return []

    const amount = Number(gross.replace(/[$,\s]/g, ''))
    if (!Number.isFinite(amount)) return []

    const paymentDate = typeof raw.PaymentDate === 'string' ? raw.PaymentDate : ''
    const [month, , year] = paymentDate.split('/')
    const period = year && month ? `${year}-${month}` : 'sem-periodo'

    // The carrier labels the agent's role on the transaction, which is exactly
    // the direct-versus-override split this page shows.
    const isOverride = raw.WritingAgtLevel === 'Override'

    return [
      {
        id: row.id,
        period,
        type: isOverride ? 'OVERRIDE' : 'DIRECT',
        level: isOverride ? 1 : 0,
        amount,
        policy: {
          id: '',
          policyNumber: typeof raw.PolicyNumber === 'string' ? raw.PolicyNumber : '—',
          agent: {
            user: { name: typeof raw.WritingAgtName === 'string' ? raw.WritingAgtName : '' },
          },
        },
      },
    ]
  })
}

export default async function CommissionsPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  let records: Record_[] = []
  let loadError = false

  try {
    const stored = await prisma.commissionRecord.findMany({
      where: { agentId: agent.id },
      include: { policy: { include: { agent: { include: { user: true } } } } },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
    })

    let carrierRecords: Record_[] = []
    if (isNationalLifeConfigured()) {
      const carrierRows = await prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: agent.id,
          deploymentScope: getNationalLifeEnv().sessionScopeId,
          gridKey: 'COMMISSION_DETAIL_NLD_COMMISSION_EARNING',
        },
        select: { id: true, raw: true, amounts: true },
      })
      carrierRecords = toCommissionRecords(carrierRows)
    }

    records = [...stored, ...carrierRecords].sort((left, right) =>
      right.period.localeCompare(left.period),
    )
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
