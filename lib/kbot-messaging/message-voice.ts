import type { ScheduledCategory } from '@/lib/kbot-templates/categories'
import {
  checkBirthdayVoice,
  containsLink,
  containsPlaceholder,
  fold,
  isAddressedTo,
  MAX_LENGTH,
  MIN_LENGTH,
  tokenize,
  type VoiceCheck,
} from './birthday-voice'

/// The same hostility as the birthday check, adjusted to what each category
/// is allowed to say.
///
/// A greeting has no business content at all, so the word "apólice" (policy)
/// is grounds for rejection there. Lapse recovery and the annual review exist
/// specifically to talk about the policy — forbidding the word would make the
/// category impossible. What stays forbidden is ASSERTING a fact: a figure, a
/// date, a policy number, a contract term. Inviting a conversation is the
/// agent's job; asserting a fact about the contract is the system's, and the
/// model is given no facts to assert — anything it wrote there would be
/// invented.
///
/// What not even these categories may say.
///
/// Status words belong here too: "sua apólice está cancelada" carries no
/// digit and no other forbidden word, but it asserts a fact about the
/// contract exactly like a figure or a date does — and it is the fact that
/// does the most damage when the model invented it. The agent is who tells a
/// client their policy's real status, in a conversation; the bot is not.
///
/// Matched on whole tokens (via `tokenize`, the one tokenisation rule this
/// module shares with `isAddressedTo`), never by substring: `ativa` as a
/// substring is inside "iniciativa", "criativa", "nativa" — ordinary words
/// with no business content — and a check that flags those kills a good
/// message by accident instead of catching an invented claim.
///
/// Single-token entries only. A phrase like "em atraso" has no single token
/// to match — it needs its own list below, checked as a run of consecutive
/// tokens.
const MONEY_AND_CONTRACT_WORDS = [
  'prêmio', 'premio', 'premium', 'pagamento', 'payment', 'desconto', 'discount',
  'benefício', 'beneficio', 'benefit', 'contrato', 'contract', 'proposta', 'quote',
  'cancelada', 'cancelado', 'cancelled', 'canceled',
  'vencida', 'vencido', 'expired',
  'suspensa', 'suspenso', 'suspended',
  'overdue',
  'inadimplente', 'lapsed', 'lapse',
  'ativa', 'ativo', 'active',
] as const

/// Multi-word entries that `MONEY_AND_CONTRACT_WORDS` cannot express as a
/// single token. Checked as a run of consecutive tokens, so "em atraso" only
/// matches when both words appear adjacent, in order — not "atraso" alone,
/// which is already covered by nothing here on purpose: "atraso" by itself
/// ("um atraso no aeroporto") is not a status claim about the policy, only
/// the full phrase is.
const MONEY_AND_CONTRACT_PHRASES = ['em atraso'] as const

/// Whether `tokens` contains `phrase`'s words, in order, adjacent — the
/// multi-word counterpart to a whole-token match in `MONEY_AND_CONTRACT_WORDS`.
function containsPhrase(tokens: string[], phrase: string): boolean {
  const wanted = tokenize(phrase)
  if (wanted.length === 0) return false
  for (let start = 0; start + wanted.length <= tokens.length; start++) {
    if (wanted.every((word, offset) => tokens[start + offset] === word)) return true
  }
  return false
}

export function checkMessageVoice(
  raw: string,
  firstName: string,
  category: ScheduledCategory,
): VoiceCheck {
  if (category === 'BIRTHDAY') return checkBirthdayVoice(raw, firstName)

  const text = raw.trim().replace(/\s+/gu, ' ')
  if (!text) return { ok: false, reason: 'EMPTY' }
  if (text.length < MIN_LENGTH) return { ok: false, reason: 'TOO_SHORT' }
  if (text.length > MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' }
  // Without the first name this isn't a message to someone, it's a notice.
  // Same guard as birthday: word-boundary match, empty name fails outright.
  if (!isAddressedTo(text, firstName)) return { ok: false, reason: 'NAME_MISSING' }
  // Every digit is an assertion: an amount, a date, a deadline, a policy number.
  if (/\d/u.test(text)) return { ok: false, reason: 'CONTAINS_NUMBER' }
  if (containsLink(text)) return { ok: false, reason: 'CONTAINS_LINK' }
  if (containsPlaceholder(text)) return { ok: false, reason: 'CONTAINS_PLACEHOLDER' }
  const words = tokenize(text)
  if (MONEY_AND_CONTRACT_WORDS.some((word) => words.includes(fold(word)))) {
    return { ok: false, reason: 'MENTIONS_BUSINESS' }
  }
  if (MONEY_AND_CONTRACT_PHRASES.some((phrase) => containsPhrase(words, phrase))) {
    return { ok: false, reason: 'MENTIONS_BUSINESS' }
  }
  return { ok: true, text }
}
