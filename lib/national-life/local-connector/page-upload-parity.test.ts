import { describe, expect, it } from 'vitest'
import { chunkRecordsForUpload } from '../../../apps/keeprone-connect/lib/record-chunks'
import { CONNECTOR_SCHEMA_VERSION } from '../../../apps/keeprone-connect/lib/contract'
import {
  MAX_TEXT_CHUNKS,
  TEXT_CHUNK_SIZE,
} from '../../../apps/keeprone-connect/lib/page-snapshot'
import {
  LOCAL_CONNECTOR_MAX_BODY_BYTES,
  LOCAL_CONNECTOR_MAX_RECORDS,
  LOCAL_CONNECTOR_MAX_ROW_BYTES,
  localConnectorRawStageEnvelopeSchema,
} from './contracts'

/// A ponte entre `capturePageSnapshot` e o endpoint de estágio nunca foi provada
/// no limite. Ela quebrou uma vez exatamente aqui: o fatiamento contava registros
/// e o `READ_PAGE` emite registros de 12 KiB, então um retrato de página larga
/// montava um corpo acima do teto — e o retry batia na mesma parede, sempre.
///
/// Estes números são os do coletor de verdade (`lib/page-snapshot.ts`), não
/// números escolhidos para o teste passar. Se o coletor mudar, este arquivo é o
/// que deve falhar primeiro.
const MAX_TABLE_ROWS = 2_000
const CELL_LIMIT = 400
const CELLS_PER_ROW = 12

const encoder = new TextEncoder()

function pageTextRecord(index: number, fill: string): Record<string, unknown> {
  return {
    RecordType: 'PAGE_TEXT',
    ChunkIndex: index,
    Text: fill.repeat(TEXT_CHUNK_SIZE).slice(0, TEXT_CHUNK_SIZE),
  }
}

function tableRowRecord(index: number): Record<string, unknown> {
  return {
    RecordType: 'TABLE_ROW',
    TableIndex: 0,
    RowIndex: index,
    Cells: Array.from({ length: CELLS_PER_ROW }, (_, cell) =>
      `c${cell}`.padEnd(CELL_LIMIT, 'x'),
    ),
  }
}

function envelopeFor(records: readonly Record<string, unknown>[], sequence: number) {
  return {
    schemaVersion: CONNECTOR_SCHEMA_VERSION,
    runId: 'run_page_parity',
    gridKey: 'AGENT_DASHBOARD',
    sequence,
    observedAt: '2026-08-11T00:00:00.000Z',
    recordsTotal: records.length,
    truncated: false,
    records,
  }
}

/// O que o servidor realmente mede: bytes UTF-8 do corpo inteiro
/// (`readLimitedBody` lê um `Uint8Array`), não unidades UTF-16.
function envelopeBytes(records: readonly Record<string, unknown>[], sequence: number): number {
  return encoder.encode(JSON.stringify(envelopeFor(records, sequence))).byteLength
}

function expectEveryChunkAccepted(records: Record<string, unknown>[]) {
  const chunks = chunkRecordsForUpload(records)
  expect(chunks.length).toBeGreaterThan(0)
  chunks.forEach((chunk, sequence) => {
    expect(chunk.length).toBeLessThanOrEqual(LOCAL_CONNECTOR_MAX_RECORDS)
    expect(envelopeBytes(chunk, sequence)).toBeLessThanOrEqual(LOCAL_CONNECTOR_MAX_BODY_BYTES)
    expect(localConnectorRawStageEnvelopeSchema.safeParse(envelopeFor(chunk, sequence)).success).toBe(
      true,
    )
  })
  return chunks
}

describe('paridade de upload do retrato de página', () => {
  it('aceita o pior retrato que o coletor pode produzir', () => {
    const records = [
      { RecordType: 'PAGE_META', Path: '/agent/', Title: 'Dashboard', Headings: [] },
      ...Array.from({ length: MAX_TEXT_CHUNKS }, (_, index) => pageTextRecord(index, 'a')),
      { RecordType: 'TABLE_META', TableIndex: 0, Headers: Array.from({ length: CELLS_PER_ROW }, () => 'h'.repeat(CELL_LIMIT)) },
      ...Array.from({ length: MAX_TABLE_ROWS }, (_, index) => tableRowRecord(index)),
    ]
    expectEveryChunkAccepted(records)
  })

  it('divide por bytes quando 200 registros não caberiam no corpo', () => {
    // A regressão concreta: o fatiamento contava registros, e um lote de 200
    // registros gordos passava de 2 MiB. Blocos de texto são o caso que ainda
    // obriga o orçamento a agir — uma tabela larga deixou de obrigar quando
    // `TABLE_META` tirou os cabeçalhos de dentro de cada linha.
    const records = Array.from({ length: MAX_TEXT_CHUNKS * 20 }, (_, index) =>
      pageTextRecord(index, 'a'),
    )
    const chunks = expectEveryChunkAccepted(records)
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThan(LOCAL_CONNECTOR_MAX_RECORDS)
  })

  it('uma tabela larga cabe em lotes cheios depois da deduplicação de cabeçalhos', () => {
    // Registrado porque foi o caso que motivou a correção: com os cabeçalhos
    // repetidos em cada linha, 200 linhas passavam do teto. Sem eles, cabem.
    const records = Array.from({ length: MAX_TABLE_ROWS }, (_, index) => tableRowRecord(index))
    expectEveryChunkAccepted(records)
  })

  it('respeita o teto de corpo com texto multibyte, que ocupa 3 bytes por caractere', () => {
    // O caso que separa "medimos bytes" de "medimos caracteres". 12.000
    // ideogramas cabem no teto por linha (que conta unidades UTF-16) e ocupam
    // ~36 KB no corpo (que conta bytes). Se o orçamento fosse em caracteres,
    // este é o teste que estouraria.
    const records = Array.from({ length: MAX_TEXT_CHUNKS * 5 }, (_, index) =>
      pageTextRecord(index, '漢'),
    )
    expectEveryChunkAccepted(records)
  })

  it('mantém cada registro do coletor abaixo do teto por linha das duas pontas', () => {
    // O teto por linha é medido em unidades UTF-16 nos dois lados, mas o
    // escape do JSON não é gratuito: cada aspa vira dois caracteres. Um bloco
    // de texto no tamanho do coletor precisa caber mesmo depois de escapado.
    const worstCase = pageTextRecord(0, '"')
    expect(JSON.stringify(worstCase).length).toBeLessThanOrEqual(LOCAL_CONNECTOR_MAX_ROW_BYTES)
  })
})
