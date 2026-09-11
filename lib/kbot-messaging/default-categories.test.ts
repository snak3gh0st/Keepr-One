import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/// A migration só pode ligar o que nunca foi decidido.
///
/// Um agente que desligou uma categoria de propósito não pode encontrá-la ligada
/// de volta depois de um deploy: isso é o app passando por cima de uma decisão
/// dele, que é o oposto do que esta entrega inteira busca.
describe('default categories migration', () => {
  const sql = readFileSync('prisma/migrations/20260912110000_kbot_default_categories_on/migration.sql', 'utf8')

  it('never touches a row that already exists', () => {
    expect(sql).toMatch(/ON CONFLICT [\s\S]* DO NOTHING/i)
  })

  it('creates them waiting for the agent, never sending on their own', () => {
    expect(sql).toMatch(/false/i)
    expect(sql).not.toMatch(/autoSend[^,]*true/i)
  })

  it('leaves the body null, so the model writes the first one', () => {
    expect(sql).toMatch(/NULL/i)
  })
})
