// Sem `server-only` de propósito, ao contrário dos módulos do conector local:
// este é carregado pelo runtime da National Life e pelo script de backfill, os
// dois rodando por `tsx`, onde `server-only` não resolve. É a mesma razão pela
// qual nenhum outro módulo de `lib/national-life/` o declara.
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

/// Diretório dos PDFs, ou `null` quando ninguém configurou um.
///
/// **Sem default.** Este é o ponto onde um default silencioso é perigoso, e não
/// conveniente: quem escreve o PDF é o runtime da National Life
/// (`workers/national-life/runtime.ts`), um container separado que não é
/// deployado pelo Coolify; quem serve o download é o container da app. Um
/// `?? './uploads'` faria o runtime gravar num diretório efêmero dentro dele
/// mesmo, gravar `storageKey` no banco compartilhado, e a app procurar aquele
/// arquivo no volume dela — onde nada foi escrito. Todo download daria 404, em
/// silêncio, e nenhum teste unitário veria: eles exercitam um sistema de
/// arquivos só.
///
/// Com `null`, o escritor cai de volta em guardar bytes no banco. Isso é o
/// comportamento antigo — gordo, mas correto — em vez de uma linha que aponta
/// para um arquivo que ninguém alcança.
export function foresightDocumentsDir(): string | null {
  const configured = process.env.UPLOADS_DIR?.trim()
  return configured ? configured : null
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
