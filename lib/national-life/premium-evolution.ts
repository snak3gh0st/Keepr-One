import { auditedNationalLifeAap } from '../policy-metrics'

export type PremiumEvolutionRow = {
  policyNumber: string
  issueDate: string | null
  premium: unknown
  product: string
}

export function buildPremiumEvolution(input: {
  rows: PremiumEvolutionRow[]
  observedAt: Date | null
  verified: boolean
  range?: string
  product?: string
  view?: string
}) {
  const range = input.range === '6' ? 6 : input.range === '24' ? 24 : 12
  const view = input.view === 'cumulative' ? 'cumulative' : 'monthly'
  const products = [...new Set(input.rows.map((row) => row.product))].sort()
  const product = products.includes(input.product ?? '') ? input.product! : ''
  const unique = new Map<string, PremiumEvolutionRow>()
  let conflict = false
  for (const row of input.rows) {
    const previous = unique.get(row.policyNumber)
    if (previous && JSON.stringify([previous.issueDate, auditedNationalLifeAap(previous.premium), previous.product])
      !== JSON.stringify([row.issueDate, auditedNationalLifeAap(row.premium), row.product])) conflict = true
    unique.set(row.policyNumber, row)
  }
  const observedAt = input.observedAt && Number.isFinite(input.observedAt.getTime()) ? input.observedAt : null
  const available = input.verified && !conflict && observedAt !== null
  const end = observedAt ?? new Date(0)
  const months = Array.from({ length: range }, (_, index) => {
    const month = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - range + index + 1, 1)).toISOString().slice(0, 7)
    return { month, policies: 0, known: 0, cents: 0, value: null as number | null, cumulative: null as number | null }
  })
  const byMonth = new Map(months.map((month) => [month.month, month]))
  let undated = 0
  let futureDated = 0
  for (const row of unique.values()) {
    if (product && row.product !== product) continue
    const date = row.issueDate ? new Date(row.issueDate) : null
    if (!date || !Number.isFinite(date.getTime())) { undated++; continue }
    if (date > end) { futureDated++; continue }
    const month = byMonth.get(date.toISOString().slice(0, 7))
    if (!month) continue
    month.policies++
    const premium = auditedNationalLifeAap(row.premium)
    if (premium !== null && Number.isSafeInteger(Math.round(premium * 100))) {
      month.known++
      month.cents += Math.round(premium * 100)
    }
  }
  let cumulative = 0
  let complete = available && undated === 0
  for (const month of months) {
    month.value = available && undated === 0 && month.known === month.policies && Number.isSafeInteger(month.cents)
      ? month.cents / 100 : null
    complete = complete && month.value !== null
    cumulative += month.cents
    complete = complete && Number.isSafeInteger(cumulative)
    month.cumulative = complete ? cumulative / 100 : null
  }
  return { range, view, product, products, available, observedAt, undated, futureDated, months,
    total: months.at(-1)?.cumulative ?? null,
    policies: months.reduce((sum, month) => sum + month.policies, 0),
    known: months.reduce((sum, month) => sum + month.known, 0),
  }
}

export type PremiumEvolution = ReturnType<typeof buildPremiumEvolution>
