// lib/kbot-templates/body-optional.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/// `body` nulo é o que permite uma categoria existir ligada antes de o agente
/// ter escrito qualquer coisa — que é a diferença entre a fila ter conteúdo no
/// primeiro dia e estar vazia para sempre.
describe('KBotMessageTemplate.body', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const model = schema.slice(schema.indexOf('model KBotMessageTemplate'))
    .slice(0, schema.slice(schema.indexOf('model KBotMessageTemplate')).indexOf('\n}'))

  it('is optional, so a category can be on before any text exists', () => {
    expect(model).toMatch(/^\s*body\s+String\?\s*$/m)
  })

  it('keeps enabled and autoSend off by default', () => {
    expect(model).toMatch(/enabled\s+Boolean\s+@default\(false\)/)
    expect(model).toMatch(/autoSend\s+Boolean\s+@default\(false\)/)
  })
})
