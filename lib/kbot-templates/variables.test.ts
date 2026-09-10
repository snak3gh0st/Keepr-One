import { describe, expect, it } from 'vitest'
import { sampleValues } from './categories'
import {
  extractPlaceholders,
  renderTemplate,
  TEMPLATE_BODY_MAX_LENGTH,
  unknownVariables,
  validateTemplateBody,
} from './variables'

const values = sampleValues('PT')

describe('template placeholders', () => {
  it('accepts inner spaces and repeats, and rejects a different casing', () => {
    expect(extractPlaceholders('Oi {{ primeiro_nome }}, {{nome}} — {{nome}}')).toEqual(['primeiro_nome', 'nome', 'nome'])
    expect(unknownVariables('Oi {{Nome}}')).toEqual(['Nome'])
    expect(unknownVariables('{{nome}}{{agente}}')).toEqual([])
  })

  it('reports each unknown name once, so the agent fixes a list and not a queue', () => {
    expect(unknownVariables('{{apolice}} {{apolice}} {{sobrenome}}')).toEqual(['apolice', 'sobrenome'])
  })
})

describe('rendering', () => {
  it('fills every known variable in a single pass', () => {
    const result = renderTemplate('Feliz aniversário, {{primeiro_nome}}! — {{agente}}', values)
    expect(result).toEqual({ ok: true, text: 'Feliz aniversário, Ana! — Paulo Loureiro' })
  })

  it('does not expand a placeholder that arrives inside a value', () => {
    const result = renderTemplate('Oi {{nome}}', { ...values, nome: '{{agente}}' })
    expect(result).toEqual({ ok: true, text: 'Oi {{agente}}' })
  })

  it('never emits a raw placeholder: an unknown name yields no text at all', () => {
    expect(renderTemplate('Oi {{sobrenome}}', values)).toEqual({ ok: false, unknown: ['sobrenome'] })
    expect(renderTemplate('Oi {{}}', values)).toEqual({ ok: false, unknown: [''] })
  })

  it('refuses an unclosed placeholder instead of sending the braces', () => {
    expect(renderTemplate('Oi {{nome', values)).toEqual({ ok: false, unknown: [] })
  })
})

describe('saving a body', () => {
  it('returns the trimmed body together with the preview that was checked', () => {
    const result = validateTemplateBody('  Oi {{primeiro_nome}}  ', values)
    expect(result).toEqual({ ok: true, body: 'Oi {{primeiro_nome}}', preview: 'Oi Ana' })
  })

  it('blocks an unknown variable at save time and names it', () => {
    expect(validateTemplateBody('Oi {{nome_do_cliente}}', values)).toEqual({
      ok: false,
      error: { code: 'UNKNOWN_VARIABLE', unknown: ['nome_do_cliente'] },
    })
  })

  it('blocks a body left half-written', () => {
    expect(validateTemplateBody('Oi {{nome}} }}', values)).toEqual({ ok: false, error: { code: 'MALFORMED' } })
    expect(validateTemplateBody('   ', values)).toEqual({ ok: false, error: { code: 'EMPTY' } })
  })

  it('blocks a body longer than a WhatsApp message should be', () => {
    const long = 'a'.repeat(TEMPLATE_BODY_MAX_LENGTH + 1)
    expect(validateTemplateBody(long, values)).toEqual({
      ok: false,
      error: { code: 'TOO_LONG', length: TEMPLATE_BODY_MAX_LENGTH + 1 },
    })
  })

  it('measures the rendered text, not only what the agent typed', () => {
    const body = `${'a'.repeat(TEMPLATE_BODY_MAX_LENGTH - 8)}{{nome}}`
    const result = validateTemplateBody(body, { ...values, nome: 'b'.repeat(300) })
    expect(result).toEqual({ ok: false, error: { code: 'RENDERED_TOO_LONG', length: TEMPLATE_BODY_MAX_LENGTH - 8 + 300 } })
  })
})
