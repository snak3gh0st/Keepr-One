// Shared money formatting so every surface reads the same. `formatMoney` for
// exact figures (case detail, ledgers); `formatCompactMoney` for aggregates
// (pipeline totals) where $4.15M beats $4,150,000.
export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value)
}

export function formatCompactMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
}
