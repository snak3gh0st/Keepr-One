// Caminhos relativos, e não o alias `@/`: este script roda por `tsx`, que não
// lê os `paths` do tsconfig. Todo script daqui que é executado assim usa
// relativo pelo mesmo motivo — o alias só falharia na hora de rodar contra
// produção.
import { prisma } from '../lib/prisma'
import {
  foresightDocumentKey,
  foresightDocumentsDir,
  readForesightDocument,
  writeForesightDocument,
} from '../lib/national-life/foresight-document-storage'

/// Move para disco os PDFs do Foresight que ficaram no Postgres.
///
/// Rode depois do deploy que introduziu `storageKey`, não antes: até lá a
/// aplicação ainda escreve `bytes`, e o backfill correria atrás do próprio rabo.
///
///   pnpm tsx scripts/national-life-backfill-foresight-documents.ts
///   pnpm tsx scripts/national-life-backfill-foresight-documents.ts --commit
///
/// Sem `--commit` só conta e mede — a passagem de ensaio é o padrão porque isto
/// escreve em disco de produção e apaga bytes do banco.
///
/// Ordem, dentro de cada linha: escreve o arquivo, relê e confere byte a byte,
/// e só então limpa a coluna. Uma linha que falhe em qualquer etapa fica como
/// estava e é reportada; a próxima passada tenta de novo. Nada aqui é destrutivo
/// sem que a cópia já esteja provada em disco.

const BATCH_SIZE = 25

type Report = {
  scanned: number
  moved: number
  failed: number
  bytesFreed: number
}

async function moveOne(row: {
  id: string
  caseSnapshotId: string
  reportKey: string
  bytes: Uint8Array | null
}, commit: boolean): Promise<number> {
  if (!row.bytes) return 0
  const storageKey = foresightDocumentKey(row.caseSnapshotId, row.reportKey)
  const dir = foresightDocumentsDir()
  if (!dir) throw new Error('UPLOADS_DIR não está configurado neste processo')
  const size = row.bytes.byteLength

  if (!commit) return size

  await writeForesightDocument(dir, storageKey, row.bytes)

  // Reler e comparar antes de apagar. Um `writeFile` que retorna sem erro num
  // disco cheio ou num volume desmontado não é prova de que o PDF está lá, e a
  // linha do banco é a única outra cópia.
  const written = await readForesightDocument(dir, storageKey)
  if (written.byteLength !== size || !written.equals(Buffer.from(row.bytes))) {
    throw new Error(`verificação falhou para ${row.id}`)
  }

  await prisma.nationalLifeForesightDocument.update({
    where: { id: row.id },
    data: { storageKey, bytes: null },
  })
  return size
}

async function main() {
  const commit = process.argv.includes('--commit')
  const report: Report = { scanned: 0, moved: 0, failed: 0, bytesFreed: 0 }

  for (;;) {
    const rows = await prisma.nationalLifeForesightDocument.findMany({
      where: { bytes: { not: null }, storageKey: null },
      select: { id: true, caseSnapshotId: true, reportKey: true, bytes: true },
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
    })
    if (rows.length === 0) break

    for (const row of rows) {
      report.scanned += 1
      try {
        report.bytesFreed += await moveOne(row, commit)
        report.moved += 1
      } catch (error) {
        report.failed += 1
        console.error(`falhou ${row.id}:`, error instanceof Error ? error.message : error)
      }
    }

    // Na passagem de ensaio nada muda no banco, então o mesmo lote voltaria para
    // sempre. Uma passada só já diz quantos e quantos bytes.
    if (!commit) break
  }

  const mb = (report.bytesFreed / 1024 / 1024).toFixed(1)
  console.log(
    commit
      ? `movidos ${report.moved}/${report.scanned} documentos, ${mb} MB fora do Postgres, ${report.failed} falhas`
      : `ensaio: ${report.scanned} documentos no primeiro lote, ${mb} MB (use --commit para mover)`,
  )
  if (report.failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
