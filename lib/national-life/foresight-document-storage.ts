import 'server-only'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

/// Onde o PDF do Foresight mora.
///
/// Morava como `Bytes` dentro do Postgres — dezenas de GB/ano num banco que
/// também serve a aplicação, com o custo pago em toda operação que toca a
/// tabela: dump, restore, réplica, autovacuum. Agora mora no mesmo volume que os
/// documentos de apólice já usam (`UPLOADS_DIR`), que no deploy é um volume
/// nomeado montado em `/data/uploads` e sobrevive a deploy.
///
/// Isto **muda o lugar** do crescimento, não o bounda: continua sem varredor
/// para arquivos de documento. A diferença é que agora cresce em disco barato e
/// não no banco quente.

const NATIONAL_LIFE_DOCUMENT_ROOT = 'national-life/foresight'

export function foresightDocumentsDir(): string {
  return process.env.UPLOADS_DIR ?? './uploads'
}

/// Chave derivada, nunca sorteada.
///
/// `upsertForesightDocument` é um upsert: rerrenderizar o mesmo relatório do
/// mesmo caso é o caso normal, não a exceção. Uma chave com UUID — como a de
/// documentos de apólice — deixaria um arquivo órfão a cada rerrenderização, e
/// não há varredor que os recolha. Derivada de `(caseSnapshotId, reportKey)`, a
/// segunda escrita sobrescreve a primeira e não sobra nada.
export function foresightDocumentKey(caseSnapshotId: string, reportKey: string): string {
  // O ponto também vira `_`: sem isso um `..` atravessa a sanitização inteira,
  // já que ela só derruba as barras. Os ids são cuids e `reportKey` é literal,
  // então nada legítimo se perde — e o `.pdf` é colado depois, fora da sanitização.
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_')
  return `${NATIONAL_LIFE_DOCUMENT_ROOT}/${safe(caseSnapshotId)}/${safe(reportKey)}.pdf`
}

/// Resolve a chave dentro do diretório de uploads e recusa qualquer coisa que
/// escape dele.
///
/// Hoje as chaves vêm de um cuid nosso e de um literal, então não há como
/// escapar. A checagem existe para que continue assim quando a origem da chave
/// mudar — `join` sozinho aceita `..` de bom grado.
export function resolveForesightDocumentPath(uploadsDir: string, storageKey: string): string {
  const root = resolve(uploadsDir)
  const full = resolve(join(root, storageKey))
  const inside = relative(root, full)
  if (inside === '' || inside.startsWith('..') || inside.startsWith(`..${sep}`)) {
    throw new Error('FORESIGHT_DOCUMENT_KEY_ESCAPES_ROOT')
  }
  return full
}

export async function writeForesightDocument(
  uploadsDir: string,
  storageKey: string,
  bytes: Uint8Array,
): Promise<void> {
  const full = resolveForesightDocumentPath(uploadsDir, storageKey)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, bytes)
}

export async function readForesightDocument(
  uploadsDir: string,
  storageKey: string,
): Promise<Buffer> {
  return readFile(resolveForesightDocumentPath(uploadsDir, storageKey))
}
