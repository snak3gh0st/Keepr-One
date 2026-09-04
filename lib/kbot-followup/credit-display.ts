/** Ledger amounts remain integer tokens. Display conversion never rounds the ledger. */
export const TOKENS_PER_CREDIT = 100
export function formatCredits(tokens: number, locale = 'pt-BR', reservation = false) {
  const credits = tokens / TOKENS_PER_CREDIT
  // An advertised maximum must cover every token in the authorization.
  return (reservation ? Math.ceil(credits) : credits).toLocaleString(locale, { maximumFractionDigits: 0 })
}
