import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'

/// A migração das categorias, rodada contra um PostgreSQL de verdade.
///
/// O teste irmão (`default-categories.test.ts`) só lê o texto do SQL, e um teste
/// que lê texto não sabe o que o banco faz: a versão anterior afirmava, pelo
/// nome, que a migração "nunca toca numa linha que já existe" enquanto conferia
/// apenas a presença de `ON CONFLICT DO NOTHING` — que protege a tripla
/// (agente, categoria, idioma) e não a decisão do agente, que é por categoria.
/// Aqui a migração roda sobre linhas semeadas e o que se afirma é o resultado.

const source = process.env.KBOT_TEST_DATABASE_URL
// `kbot_plan_check` é o banco descartável do plano: criado e destruído aqui,
// nunca o banco de integração, que guarda as fixtures dos outros testes.
const SCRATCH = 'kbot_plan_check'
const migration = 'prisma/migrations/20260912110000_kbot_default_categories_on/migration.sql'

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

let db: PrismaClient

async function seedAgent(id: string, language: 'PT' | 'EN') {
  await db.user.create({ data: { id: `u-${id}`, email: `${id}@example.invalid`, name: 'Paulo Loureiro', role: 'AGENT', language } })
  await db.agent.create({ data: { id, userId: `u-${id}`, rank: 'AGENT', status: 'ACTIVE' } })
}

describe.skipIf(!source)('the default-categories migration, against PostgreSQL', () => {
  beforeAll(async () => {
    const admin = new PrismaClient({ datasourceUrl: withDatabase(source!, 'postgres') })
    // `WITH (FORCE)` derruba conexões pendentes de uma execução anterior que
    // tenha morrido no meio; sem ele um DROP fica esperando para sempre.
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH}"`)
    await admin.$disconnect()
    const url = withDatabase(source!, SCRATCH)
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' })
    db = new PrismaClient({ datasourceUrl: url })
  }, 300_000)

  afterAll(async () => {
    await db?.$disconnect()
  })

  it('leaves a category the agent switched off alone, even in another language', async () => {
    await db.kBotMessageTemplate.deleteMany({})
    await db.agent.deleteMany({})
    await db.user.deleteMany({})
    // O agente fala EN — é a linha que o motor lê — e a única linha que ele tem
    // é PT, desligada de propósito. É a forma exata em que a tela e as duas
    // server actions deixam uma categoria desligada: `updateMany` sobre os
    // idiomas que existem, e nenhum outro é criado.
    await seedAgent('agent-en', 'EN')
    await db.kBotMessageTemplate.create({ data: {
      agentId: 'agent-en', category: 'LAPSE_RECOVERY', language: 'PT', body: 'Oi {{primeiro_nome}}', enabled: false,
    } })

    await db.$executeRawUnsafe(readFileSync(migration, 'utf8'))

    const lapse = await db.kBotMessageTemplate.findMany({
      where: { agentId: 'agent-en', category: 'LAPSE_RECOVERY' },
      select: { language: true, enabled: true },
    })
    expect(lapse).toEqual([{ language: 'PT', enabled: false }])
    // E o resto da migração continua fazendo o seu trabalho: as categorias em
    // que ele nunca decidiu nada nascem ligadas, no idioma dele.
    const decided = await db.kBotMessageTemplate.findMany({
      where: { agentId: 'agent-en', enabled: true },
      select: { category: true, language: true, body: true, autoSend: true },
      orderBy: { category: 'asc' },
    })
    expect(decided).toEqual([
      { category: 'ANNUAL_REVIEW', language: 'EN', body: null, autoSend: false },
      { category: 'BIRTHDAY', language: 'EN', body: null, autoSend: false },
    ])
  })

  it('turns every category on for an agent who never decided anything', async () => {
    await db.kBotMessageTemplate.deleteMany({})
    await db.agent.deleteMany({})
    await db.user.deleteMany({})
    await seedAgent('agent-pt', 'PT')

    await db.$executeRawUnsafe(readFileSync(migration, 'utf8'))

    const rows = await db.kBotMessageTemplate.findMany({
      where: { agentId: 'agent-pt' },
      select: { category: true, language: true, enabled: true, autoSend: true, body: true },
      orderBy: { category: 'asc' },
    })
    expect(rows).toEqual([
      { category: 'ANNUAL_REVIEW', language: 'PT', enabled: true, autoSend: false, body: null },
      { category: 'BIRTHDAY', language: 'PT', enabled: true, autoSend: false, body: null },
      { category: 'LAPSE_RECOVERY', language: 'PT', enabled: true, autoSend: false, body: null },
    ])
  })

  it('is safe to run twice, creating nothing the second time', async () => {
    await db.kBotMessageTemplate.deleteMany({})
    await db.agent.deleteMany({})
    await db.user.deleteMany({})
    await seedAgent('agent-twice', 'PT')

    await db.$executeRawUnsafe(readFileSync(migration, 'utf8'))
    await db.$executeRawUnsafe(readFileSync(migration, 'utf8'))

    expect(await db.kBotMessageTemplate.count({ where: { agentId: 'agent-twice' } })).toBe(3)
  })
})
