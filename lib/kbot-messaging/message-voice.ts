import type { ScheduledCategory } from '@/lib/kbot-templates/categories'
import {
  checkBirthdayVoice,
  containsLink,
  containsPlaceholder,
  fold,
  isAddressedTo,
  MAX_LENGTH,
  MIN_LENGTH,
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
const MONEY_AND_CONTRACT = [
  'prêmio', 'premio', 'premium', 'pagamento', 'payment', 'desconto', 'discount',
  'benefício', 'beneficio', 'benefit', 'contrato', 'contract', 'proposta', 'quote',
] as const

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
  const lowered = fold(text)
  if (MONEY_AND_CONTRACT.some((word) => lowered.includes(fold(word)))) {
    return { ok: false, reason: 'MENTIONS_BUSINESS' }
  }
  return { ok: true, text }
}
