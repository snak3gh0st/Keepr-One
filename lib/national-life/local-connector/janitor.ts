import 'server-only'
import type { PrismaClient } from '@prisma/client'
import { LOCAL_CONNECTOR_SIGNATURE_WINDOW_MS } from './device-signature'

/// Varredura das tabelas que o conector local faz crescer para sempre.
///
/// Três tabelas ganham linhas por operação e nenhuma tinha quem as apagasse.
/// `NationalLifeConnectorReplay` é a pior: uma linha por requisição assinada,
/// com `expiresAt` escrito e indexado desde o primeiro dia e nunca lido. Um sync
/// completo do livro são ~53 requisições assinadas por agente; a 100 agentes por
/// dia isso é ~5.300 linhas/dia, ~1,9 M/ano, num banco que também serve a
/// aplicação. Recibos de estágio e pairings consumidos crescem pelo mesmo motivo,
/// mais devagar.
///
/// O que este módulo *não* faz: apagar `NationalLifeSyncRun`. O run é o registro
/// do que o agente mandou fazer e é o que a tela lê; some junto com o agente, via
/// cascade. Recibos são apagados sem o run porque são detalhe de transporte.

/// Margem atrás do vencimento antes de apagar uma linha de replay.
///
/// A janela de assinatura já rejeita, sozinha, qualquer requisição cujo timestamp
/// esteja a mais de `LOCAL_CONNECTOR_SIGNATURE_WINDOW_MS` do relógio do servidor —
/// e `expiresAt` é exatamente `timestamp + janela`, derivado do mesmo instante que
/// aquela checagem usa. Ou seja: quando `expiresAt` passa, a assinatura daquele
/// `jti` já é irrecebível por conta própria, e a linha só existe como lastro. A
/// margem extra de uma janela inteira é folga barata: mesmo que a checagem de
/// timestamp mude, ainda sobra uma janela de detecção de replay depois do
/// vencimento.
export const LOCAL_CONNECTOR_REPLAY_GRACE_MS = LOCAL_CONNECTOR_SIGNATURE_WINDOW_MS

/// Um pairing vive 5 minutos e o resgate exige `consumedAt: null` e `expiresAt`
/// no futuro — vencido ou consumido, a linha não abre mais nenhuma porta. As 24h
/// são só para o suporte conseguir olhar um pareamento do mesmo dia.
export const LOCAL_CONNECTOR_PAIRING_RETENTION_MS = 24 * 60 * 60_000

/// Recibos são a chave de idempotência do upload de estágio: apagar um recibo de
/// um run que ainda pode receber upload transforma um reenvio em escrita dupla.
/// Por isso a varredura não olha a idade do recibo, e sim a do run — e só de run
/// em estado terminal. Trinta dias sem nenhuma atividade no run é ordens de
/// grandeza além de qualquer retentativa de dispositivo.
export const LOCAL_CONNECTOR_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60_000

/// Estados em que um run não recebe mais upload. `ingestLocalConnectorStage`
/// aceita `RUNNING` e `COMPLETED` — `COMPLETED` continua aqui porque o corte que
/// vale é a inatividade de 30 dias, e qualquer upload aceito depois de completo
/// atualiza o run e reinicia essa contagem.
const TERMINAL_RUN_STATES = ['COMPLETED', 'PARTIAL', 'FAILED'] as const

/// Linhas por lote. Um `deleteMany` único sobre uma tabela dimensionada para
/// 1,9 M linhas/ano trava e incha; o laço em lotes devolve o banco entre um e
/// outro.
export const LOCAL_CONNECTOR_SWEEP_BATCH_SIZE = 1_000

/// Teto de lotes por tabela, por passada. Existe para a varredura não virar uma
/// transação eterna na primeira execução contra uma tabela já grande: ela para,
/// reporta `truncated`, e a próxima passada continua de onde parou.
export const LOCAL_CONNECTOR_SWEEP_MAX_BATCHES = 50

type JanitorDb = Pick<
  PrismaClient,
  | 'nationalLifeConnectorReplay'
  | 'nationalLifeConnectorPairing'
  | 'nationalLifeConnectorStageReceipt'
>

export type LocalConnectorSweepTableReport = {
  deleted: number
  /// `true` quando o teto de lotes foi atingido e ainda havia o que apagar.
  truncated: boolean
}

export type LocalConnectorSweepReport = {
  replays: LocalConnectorSweepTableReport
  pairings: LocalConnectorSweepTableReport
  stageReceipts: LocalConnectorSweepTableReport
  /// Milissegundos de parede da passada inteira.
  durationMs: number
}

export type LocalConnectorSweepOptions = {
  now?: Date
  batchSize?: number
  maxBatches?: number
}

/// Apaga em lotes: seleciona ids, apaga por id, repete. Selecionar antes de
/// apagar é o que mantém cada `deleteMany` limitado — o predicado de tempo sozinho
/// casaria a tabela inteira.
async function sweepInBatches(
  selectIds: (take: number) => Promise<{ id: string }[]>,
  deleteIds: (ids: string[]) => Promise<{ count: number }>,
  batchSize: number,
  maxBatches: number,
): Promise<LocalConnectorSweepTableReport> {
  let deleted = 0

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await selectIds(batchSize)
    if (rows.length === 0) return { deleted, truncated: false }

    const { count } = await deleteIds(rows.map((row) => row.id))
    deleted += count

    // Lote curto significa que a seleção esgotou o que casava: acabou, e sem
    // pagar uma consulta a mais para descobrir isso.
    if (rows.length < batchSize) return { deleted, truncated: false }
  }

  return { deleted, truncated: true }
}

export async function sweepLocalConnectorTables(
  db: JanitorDb,
  options: LocalConnectorSweepOptions = {},
): Promise<LocalConnectorSweepReport> {
  const now = options.now ?? new Date()
  const startedAt = Date.now()
  const batchSize = options.batchSize ?? LOCAL_CONNECTOR_SWEEP_BATCH_SIZE
  const maxBatches = options.maxBatches ?? LOCAL_CONNECTOR_SWEEP_MAX_BATCHES

  const replayCutoff = new Date(now.getTime() - LOCAL_CONNECTOR_REPLAY_GRACE_MS)
  const pairingCutoff = new Date(now.getTime() - LOCAL_CONNECTOR_PAIRING_RETENTION_MS)
  const receiptCutoff = new Date(now.getTime() - LOCAL_CONNECTOR_RECEIPT_RETENTION_MS)

  const replays = await sweepInBatches(
    (take) =>
      db.nationalLifeConnectorReplay.findMany({
        where: { expiresAt: { lt: replayCutoff } },
        select: { id: true },
        take,
      }),
    (ids) => db.nationalLifeConnectorReplay.deleteMany({ where: { id: { in: ids } } }),
    batchSize,
    maxBatches,
  )

  const pairings = await sweepInBatches(
    (take) =>
      db.nationalLifeConnectorPairing.findMany({
        where: {
          OR: [
            { expiresAt: { lt: pairingCutoff } },
            { consumedAt: { lt: pairingCutoff } },
          ],
        },
        select: { id: true },
        take,
      }),
    (ids) => db.nationalLifeConnectorPairing.deleteMany({ where: { id: { in: ids } } }),
    batchSize,
    maxBatches,
  )

  const stageReceipts = await sweepInBatches(
    (take) =>
      db.nationalLifeConnectorStageReceipt.findMany({
        where: {
          run: {
            state: { in: [...TERMINAL_RUN_STATES] },
            updatedAt: { lt: receiptCutoff },
          },
        },
        select: { id: true },
        take,
      }),
    (ids) => db.nationalLifeConnectorStageReceipt.deleteMany({ where: { id: { in: ids } } }),
    batchSize,
    maxBatches,
  )

  return { replays, pairings, stageReceipts, durationMs: Date.now() - startedAt }
}
