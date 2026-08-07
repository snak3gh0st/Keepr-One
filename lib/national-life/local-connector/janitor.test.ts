import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  LOCAL_CONNECTOR_PAIRING_RETENTION_MS,
  LOCAL_CONNECTOR_RECEIPT_RETENTION_MS,
  LOCAL_CONNECTOR_REPLAY_GRACE_MS,
  sweepLocalConnectorTables,
} from './janitor'
import { LOCAL_CONNECTOR_SIGNATURE_WINDOW_MS } from './device-signature'

const NOW = new Date('2026-08-05T18:00:00.000Z')

function ids(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }))
}

/// Tabela cujo `findMany` devolve os lotes roteirizados, em ordem, e `[]` depois
/// que a lista acaba. É o suficiente para exercitar o laço de lotes sem
/// reimplementar o Prisma.
type FindManyArgs = { where: Record<string, unknown>; select: { id: true }; take: number }

function scriptedTable(batches: { id: string }[][]) {
  const findMany = vi.fn(async (_args: FindManyArgs) => batches.shift() ?? [])
  const deleteMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
    count: where.id.in.length,
  }))
  return { findMany, deleteMany }
}

function dbWith(overrides: {
  replays?: { id: string }[][]
  pairings?: { id: string }[][]
  receipts?: { id: string }[][]
}) {
  const replay = scriptedTable(overrides.replays ?? [])
  const pairing = scriptedTable(overrides.pairings ?? [])
  const receipt = scriptedTable(overrides.receipts ?? [])
  return {
    db: {
      nationalLifeConnectorReplay: replay,
      nationalLifeConnectorPairing: pairing,
      nationalLifeConnectorStageReceipt: receipt,
    } as never,
    replay,
    pairing,
    receipt,
  }
}

describe('local connector janitor predicates', () => {
  it('only deletes replay rows a full signature window past their expiry', async () => {
    const { db, replay } = dbWith({})

    await sweepLocalConnectorTables(db, { now: NOW })

    expect(replay.findMany.mock.calls[0][0].where).toEqual({
      expiresAt: { lt: new Date(NOW.getTime() - LOCAL_CONNECTOR_REPLAY_GRACE_MS) },
    })
    // A margem é a própria janela de assinatura: se ela encolher para zero, a
    // linha some no instante em que a verificação de timestamp ainda a usaria.
    expect(LOCAL_CONNECTOR_REPLAY_GRACE_MS).toBe(LOCAL_CONNECTOR_SIGNATURE_WINDOW_MS)
  })

  it('deletes pairings that expired or were consumed past the retention window', async () => {
    const { db, pairing } = dbWith({})

    await sweepLocalConnectorTables(db, { now: NOW })

    const cutoff = new Date(NOW.getTime() - LOCAL_CONNECTOR_PAIRING_RETENTION_MS)
    expect(pairing.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }],
    })
  })

  it('deletes stage receipts only for terminal runs idle past the retention window', async () => {
    const { db, receipt } = dbWith({})

    await sweepLocalConnectorTables(db, { now: NOW })

    // O recorte é a idade do *run*, não a do recibo: um recibo é a chave de
    // idempotência de um upload, e apagá-lo enquanto o run ainda aceita upload
    // transforma um reenvio em escrita dupla.
    expect(receipt.findMany.mock.calls[0][0].where).toEqual({
      run: {
        state: { in: ['COMPLETED', 'PARTIAL', 'FAILED'] },
        updatedAt: { lt: new Date(NOW.getTime() - LOCAL_CONNECTOR_RECEIPT_RETENTION_MS) },
      },
    })
  })

  it('never sweeps receipts of a run that can still be uploaded to', async () => {
    const { db, receipt } = dbWith({})

    await sweepLocalConnectorTables(db, { now: NOW })

    const where = receipt.findMany.mock.calls[0][0].where as {
      run: { state: { in: string[] } }
    }
    const states = where.run.state.in
    expect(states).not.toContain('RUNNING')
    expect(states).not.toContain('QUEUED')
    expect(states).not.toContain('PAUSED')
  })
})

describe('local connector janitor indexes', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')

  function indexesOf(model: string): string[] {
    const body = schema.split(`model ${model} {`)[1]?.split('\n}')[0] ?? ''
    return [...body.matchAll(/@@index\(\[([^\]]+)\]\)/g)].map((match) =>
      match[1].replace(/\s/g, ''),
    )
  }

  it('backs the stage receipt sweep with an index on the run columns it filters', () => {
    // O predicado é `run: { state, updatedAt }`. Os índices que já existiam
    // começam por `agentId`, e esta varredura não filtra agente nenhum — varre a
    // tabela inteira. Mudar o predicado sem mudar o índice devolve a varredura ao
    // sequential scan, e nada além deste teste avisaria.
    expect(indexesOf('NationalLifeSyncRun')).toContain('state,updatedAt')
  })

  it('backs the pairing sweep with one index per branch of its OR', () => {
    // Um composto `(expiresAt, consumedAt)` serviria só ao primeiro ramo. Dois de
    // uma coluna deixam o Postgres resolver o OR com BitmapOr.
    const indexes = indexesOf('NationalLifeConnectorPairing')
    expect(indexes).toContain('expiresAt')
    expect(indexes).toContain('consumedAt')
  })

  it('leaves the replay sweep on the index it already had', () => {
    expect(indexesOf('NationalLifeConnectorReplay')).toContain('expiresAt')
  })
})

describe('local connector janitor batching', () => {
  it('deletes exactly the ids the selection returned', async () => {
    const { db, replay } = dbWith({ replays: [ids(3, 'replay')] })

    const report = await sweepLocalConnectorTables(db, { now: NOW, batchSize: 10 })

    expect(replay.deleteMany).toHaveBeenCalledTimes(1)
    expect(replay.deleteMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['replay-0', 'replay-1', 'replay-2'] } },
    })
    expect(report.replays).toEqual({ deleted: 3, truncated: false })
  })

  it('keeps going while batches come back full and stops on a short one', async () => {
    const { db, replay } = dbWith({ replays: [ids(2, 'a'), ids(2, 'b'), ids(1, 'c')] })

    const report = await sweepLocalConnectorTables(db, {
      now: NOW,
      batchSize: 2,
      maxBatches: 10,
    })

    expect(replay.findMany).toHaveBeenCalledTimes(3)
    expect(replay.deleteMany).toHaveBeenCalledTimes(3)
    expect(report.replays).toEqual({ deleted: 5, truncated: false })
  })

  it('asks for at most batchSize rows per query', async () => {
    const { db, replay } = dbWith({ replays: [ids(2, 'a')] })

    await sweepLocalConnectorTables(db, { now: NOW, batchSize: 2 })

    // Sem `take` o `findMany` traria a tabela inteira para a memória do
    // processo, que é o custo exato que os lotes existem para evitar.
    expect(replay.findMany.mock.calls[0][0].take).toBe(2)
  })

  it('stops at the batch ceiling and reports the sweep as truncated', async () => {
    const full = Array.from({ length: 20 }, (_, index) => ids(2, `batch-${index}`))
    const { db, replay } = dbWith({ replays: full })

    const report = await sweepLocalConnectorTables(db, {
      now: NOW,
      batchSize: 2,
      maxBatches: 3,
    })

    expect(replay.findMany).toHaveBeenCalledTimes(3)
    expect(report.replays).toEqual({ deleted: 6, truncated: true })
  })

  it('does not issue a delete when nothing matches', async () => {
    const { db, replay, pairing, receipt } = dbWith({})

    const report = await sweepLocalConnectorTables(db, { now: NOW })

    expect(replay.deleteMany).not.toHaveBeenCalled()
    expect(pairing.deleteMany).not.toHaveBeenCalled()
    expect(receipt.deleteMany).not.toHaveBeenCalled()
    expect(report.replays.deleted).toBe(0)
    expect(report.pairings.deleted).toBe(0)
    expect(report.stageReceipts.deleted).toBe(0)
  })

  it('sweeps all three tables in one pass', async () => {
    const { db, replay, pairing, receipt } = dbWith({
      replays: [ids(1, 'r')],
      pairings: [ids(2, 'p')],
      receipts: [ids(3, 's')],
    })

    const report = await sweepLocalConnectorTables(db, { now: NOW, batchSize: 10 })

    expect(replay.deleteMany).toHaveBeenCalledTimes(1)
    expect(pairing.deleteMany).toHaveBeenCalledTimes(1)
    expect(receipt.deleteMany).toHaveBeenCalledTimes(1)
    expect(report.replays.deleted).toBe(1)
    expect(report.pairings.deleted).toBe(2)
    expect(report.stageReceipts.deleted).toBe(3)
  })
})
