import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/// O texto do SQL da migration — nada além disso.
///
/// Estes casos leem o arquivo; eles não sabem o que o banco faz com ele. A
/// pergunta que importa — um agente que desligou uma categoria continua com ela
/// desligada depois do deploy? — é respondida em
/// `default-categories.integration.test.ts`, rodando a migration num PostgreSQL
/// de verdade. Um nome de teste afirmando a invariante sem exercê-la é pior do
/// que teste nenhum, e já esteve aqui.
describe('default categories migration', () => {
  const sql = readFileSync('prisma/migrations/20260912110000_kbot_default_categories_on/migration.sql', 'utf8')

  it('carries both guards: the row-level conflict clause and the category-level one', () => {
    expect(sql).toMatch(/ON CONFLICT [\s\S]* DO NOTHING/i)
    expect(sql).toMatch(/NOT EXISTS[\s\S]*t\."category" = c\."category"/i)
  })

  it('creates them waiting for the agent, never sending on their own', () => {
    expect(sql).toMatch(/false/i)
    expect(sql).not.toMatch(/autoSend[^,]*true/i)
  })

  it('leaves the body null, so the model writes the first one', () => {
    expect(sql).toMatch(/NULL/i)
  })
})
