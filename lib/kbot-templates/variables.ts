/// The variables an agent may write inside a scheduled message, and the only
/// place that knows the `{{...}}` syntax.
///
/// A scheduled message leaves without anyone reading it first. If a typo like
/// `{{nome_do_cliente}}` survived until send time, the client would receive the
/// braces themselves — so the same extractor that renders the text also decides
/// whether the text may be saved at all. Two regexes would eventually disagree;
/// there is one.

export const TEMPLATE_VARIABLES = ['nome', 'primeiro_nome', 'agente'] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]
export type TemplateValues = Record<TemplateVariable, string>

/// Long enough for a warm greeting, short enough that no one writes a
/// newsletter into a WhatsApp bubble. The rendered text is checked too: a
/// template that fits only because the names are still placeholders is not
/// really within the limit.
export const TEMPLATE_BODY_MAX_LENGTH = 700
export const RENDERED_MAX_LENGTH = 900

/// `{{ nome }}` and `{{nome}}` are the same variable. Names are matched exactly
/// as written — `{{Nome}}` is unknown, because guessing at casing is how a
/// second, quieter set of rules gets invented.
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g

/// Every `{{...}}` in the body, in the order it appears, repeats included.
export function extractPlaceholders(body: string): string[] {
  return Array.from(body.matchAll(PLACEHOLDER), (match) => match[1])
}

function isKnown(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name)
}

/// The names the agent typed that this system cannot fill, deduplicated.
export function unknownVariables(body: string): string[] {
  const unknown: string[] = []
  for (const name of extractPlaceholders(body)) {
    if (!isKnown(name) && !unknown.includes(name)) unknown.push(name)
  }
  return unknown
}

/// A brace left over after every well-formed placeholder is removed. `{{nome`
/// never matches the placeholder pattern, so without this check it would sail
/// through validation and reach the recipient verbatim.
export function hasStrayBraces(body: string): boolean {
  const rest = body.replace(PLACEHOLDER, '')
  return rest.includes('{{') || rest.includes('}}')
}

export type RenderResult =
  | { ok: true; text: string }
  | { ok: false; unknown: string[] }

/// Total by construction: either every placeholder was filled, or nothing comes
/// back. There is no branch that emits a raw `{{ }}`.
export function renderTemplate(body: string, values: TemplateValues): RenderResult {
  const unknown = unknownVariables(body)
  if (unknown.length || hasStrayBraces(body)) return { ok: false, unknown }
  // A single pass: a value that happens to contain `{{agente}}` — a client
  // really named that — is inserted as text and never expanded again.
  return {
    ok: true,
    text: body.replace(PLACEHOLDER, (_match, name: string) => values[name as TemplateVariable]),
  }
}

export type TemplateBodyError =
  | { code: 'EMPTY' }
  | { code: 'TOO_LONG'; length: number }
  | { code: 'RENDERED_TOO_LONG'; length: number }
  | { code: 'MALFORMED' }
  | { code: 'UNKNOWN_VARIABLE'; unknown: string[] }

export type TemplateBodyResult =
  | { ok: true; body: string; preview: string }
  | { ok: false; error: TemplateBodyError }

/// The gate every save passes through, on the server. The preview the agent
/// approves on screen is the same string this function produces, so what was
/// read is what was accepted.
export function validateTemplateBody(input: string, sample: TemplateValues): TemplateBodyResult {
  const body = input.trim()
  if (!body) return { ok: false, error: { code: 'EMPTY' } }
  if (body.length > TEMPLATE_BODY_MAX_LENGTH) {
    return { ok: false, error: { code: 'TOO_LONG', length: body.length } }
  }
  const unknown = unknownVariables(body)
  if (unknown.length) return { ok: false, error: { code: 'UNKNOWN_VARIABLE', unknown } }
  if (hasStrayBraces(body)) return { ok: false, error: { code: 'MALFORMED' } }
  const rendered = renderTemplate(body, sample)
  if (!rendered.ok) return { ok: false, error: { code: 'UNKNOWN_VARIABLE', unknown: rendered.unknown } }
  if (rendered.text.length > RENDERED_MAX_LENGTH) {
    return { ok: false, error: { code: 'RENDERED_TOO_LONG', length: rendered.text.length } }
  }
  return { ok: true, body, preview: rendered.text }
}
