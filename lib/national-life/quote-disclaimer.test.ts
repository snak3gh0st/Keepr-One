import { describe, expect, it } from 'vitest'
import { QUOTE_DISCLAIMER } from './quote-disclaimer'

// Three clauses must never be lost from this string, no matter how it gets
// reworded later. Asserting on substrings — not the whole sentence — means a
// future edit that keeps two of the three but drops one still fails loudly,
// instead of quietly shipping a weaker condition on both screens at once.
describe('QUOTE_DISCLAIMER', () => {
  // Distinguishes a quote from a proposal. The two are different documents
  // with different legal weight, and calling a quote a "proposta" implies a
  // commitment nobody has made yet.
  it('says this is a quote, not a proposal', () => {
    expect(QUOTE_DISCLAIMER).toContain('Cotação, não proposta')
  })

  // The numbers are demonstrative, not a promise. Losing this clause is how a
  // screen ends up looking like it guarantees a premium or a payout the
  // carrier has not actually committed to.
  it('says the values are not guaranteed', () => {
    expect(QUOTE_DISCLAIMER).toContain('não são garantidos')
  })

  // The one instruction that keeps this screen out of a client's hands. If
  // this clause disappears, an agent has no textual reason not to forward the
  // page straight to the client it was never cleared for.
  it('says it must not be shown to the client', () => {
    expect(QUOTE_DISCLAIMER).toContain('não pode ser exibido a ele')
  })
})
