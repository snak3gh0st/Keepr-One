import 'server-only'
import OpenAI from 'openai'
import { MAX_LENGTH, type VoiceCheck, type VoiceRejection } from './birthday-voice'

/// The shared call-and-account envelope every model-backed voice generator uses.
///
/// The birthday greeting and the scheduled messages (annual review, lapse
/// recovery) differ only in their instructions, their payload and how the
/// output is checked. Everything else — resolving the model, honoring the
/// enabled gate, the fixed timeout and no retries, how a timeout is charged,
/// how usage is read off the response, the REFUSED exit, the truncation
/// before checking — is identical, and lives here once. A correction to the
/// assumed-attempt estimate, or to how usage is read, now applies to every
/// category at once instead of drifting between copies.

/// What an attempt is assumed to have cost when the provider never told us.
/// The instructions are fixed and the output is capped, so a real call sits
/// near this; it is an estimate chosen to be closer to over- than under-stating.
export const ASSUMED_ATTEMPT_TOKENS = { inputTokens: 160, outputTokens: 60 }

/// `attempted` says a request reached the provider, whatever came back.
///
/// It matters for billing: a timeout returns no usage, but the other side may
/// well have processed the request. Treating that as "no model was called"
/// would make a retry loop free, so an attempt is charged at a conservative
/// estimate rather than at zero.
export type VoiceModelCallResult =
  | { ok: true; text: string; attempted: true; model: string; inputTokens: number; outputTokens: number }
  | { ok: false; reason: VoiceRejection | 'UNAVAILABLE' | 'REFUSED'; attempted: boolean; model: string; inputTokens: number; outputTokens: number }

export async function callVoiceModel(params: {
  enabled: boolean
  instructions: string
  payload: Record<string, unknown>
  maxOutputTokens: number
  check: (rawText: string) => VoiceCheck
}): Promise<VoiceModelCallResult> {
  const model = process.env.KBOT_FOLLOWUP_MODEL || 'gpt-4o-mini'
  const empty = { model, inputTokens: 0, outputTokens: 0 }
  // Nothing was asked of anyone, so nothing is owed.
  if (!params.enabled) return { ok: false, reason: 'UNAVAILABLE', attempted: false, ...empty }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 20_000 })
  let response
  try {
    response = await client.responses.create({
      model,
      store: false,
      max_output_tokens: params.maxOutputTokens,
      instructions: params.instructions,
      input: JSON.stringify(params.payload),
    })
  } catch {
    // A timeout or a transport error: the request may have been processed on
    // the other side, and we will never know. Charged as an attempt.
    return { ok: false, reason: 'UNAVAILABLE', attempted: true, model, ...ASSUMED_ATTEMPT_TOKENS }
  }

  const usage = {
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  }
  if (response.status !== 'completed') return { ok: false, reason: 'REFUSED', attempted: true, ...usage }

  // Checked, not trusted. Text that strays is discarded and the caller falls
  // back to its own template, so the worst case is a less varied message
  // rather than one nobody approved.
  const checked = params.check(String(response.output_text ?? '').slice(0, MAX_LENGTH * 4))
  return checked.ok
    ? { ok: true, text: checked.text, attempted: true, ...usage }
    : { ok: false, reason: checked.reason, attempted: true, ...usage }
}
