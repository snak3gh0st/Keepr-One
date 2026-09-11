/// Letting the model write the greeting, and deciding whether to send what it
/// wrote.
///
/// Everywhere else in this codebase the model is not allowed to produce text:
/// `kbot-followup/generation.ts` has it pick a style from an enum and composes
/// the sentence in code, precisely so nothing it invents can reach a client. A
/// birthday greeting is the deliberate exception — the whole point is that it
/// does not read like the same message every year — and the exception is paid
/// for here, with a check that is hostile by default.
///
/// The rule the checks encode: a birthday message may say happy birthday and
/// nothing else. No figure, no link, no mention of a policy, no promise. If the
/// model strays, the agent's own template goes out instead, so the failure mode
/// is "the message is less varied", never "the message says something nobody
/// approved".

export const MAX_LENGTH = 220
export const MIN_LENGTH = 15

/// Words that have no business in a birthday greeting. Anything about money,
/// cover or the contract is the agent's to say, in a conversation, not a line
/// the bot slipped into a celebration.
const FORBIDDEN = [
  'apólice', 'apolice', 'policy', 'prêmio', 'premio', 'premium', 'cobertura',
  'coverage', 'seguro', 'insurance', 'benefício', 'beneficio', 'benefit',
  'contrato', 'contract', 'pagamento', 'payment', 'desconto', 'discount',
  'renovação', 'renovacao', 'renewal', 'proposta', 'quote',
]

export type VoiceRejection =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'NAME_MISSING'
  | 'CONTAINS_NUMBER'
  | 'CONTAINS_LINK'
  | 'CONTAINS_PLACEHOLDER'
  | 'MENTIONS_BUSINESS'

export type VoiceCheck =
  | { ok: true; text: string }
  | { ok: false; reason: VoiceRejection }

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/// Whether the model's greeting may be sent as written.
export function checkBirthdayVoice(raw: string, firstName: string): VoiceCheck {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return { ok: false, reason: 'EMPTY' }
  if (text.length < MIN_LENGTH) return { ok: false, reason: 'TOO_SHORT' }
  if (text.length > MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' }
  // It has to be addressed to the person. A greeting that forgot the name reads
  // like a broadcast, which is the one thing it must not look like.
  //
  // Matched at word boundaries, not by substring: `Ana` is inside `Banana`, and
  // a check that accepts that is a check that accepts a greeting addressed to
  // nobody. An empty name fails outright — `includes('')` is true for every
  // string, so without this the whole check would silently pass everything.
  const wanted = fold(firstName.trim())
  if (!wanted) return { ok: false, reason: 'NAME_MISSING' }
  const named = fold(text)
    .split(/[^\p{L}\p{M}\p{N}']+/u)
    .some((token) => token === wanted)
  if (!named) return { ok: false, reason: 'NAME_MISSING' }
  // No digits at all: an age, a year, a figure, a date — none of them are safe
  // to invent, and a birthday greeting needs none of them.
  if (/\d/.test(text)) return { ok: false, reason: 'CONTAINS_NUMBER' }
  // Bare domains count: `veja em exemplo.com` is a link to the person reading
  // it, whether or not the model wrote a scheme in front of it.
  if (/https?:\/\/|www\.|@\w+\.\w|\b[\p{L}\p{N}-]+\.(com|net|org|io|br|co|app|link)\b/iu.test(text)) {
    return { ok: false, reason: 'CONTAINS_LINK' }
  }
  // Single braces too: `{nome}` is as wrong in a client's chat as `{{nome}}`.
  if (/[{}[\]]/.test(text)) return { ok: false, reason: 'CONTAINS_PLACEHOLDER' }
  const folded = fold(text)
  if (FORBIDDEN.some((word) => folded.includes(fold(word)))) {
    return { ok: false, reason: 'MENTIONS_BUSINESS' }
  }
  return { ok: true, text }
}
