import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  foresightDocumentKey,
  foresightDocumentsDir,
  readForesightDocument,
  resolveForesightDocumentPath,
  writeForesightDocument,
} from './foresight-document-storage'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'foresight-docs-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('foresight document key', () => {
  it('derives the same key for the same case and report', () => {
    // Um upsert rerrenderiza o mesmo relatório do mesmo caso o tempo todo. Chave
    // sorteada deixaria um arquivo órfão a cada vez, e não há varredor para eles.
    expect(foresightDocumentKey('case-1', 'foresight-report')).toBe(
      foresightDocumentKey('case-1', 'foresight-report'),
    )
    expect(foresightDocumentKey('case-1', 'foresight-report')).not.toBe(
      foresightDocumentKey('case-2', 'foresight-report'),
    )
  })

  it('neutralizes anything that could climb out of the directory', () => {
    const key = foresightDocumentKey('../../etc', 'passwd/../..')
    expect(key).not.toContain('..')
    expect(() => resolveForesightDocumentPath('/srv/uploads', key)).not.toThrow()
  })
})

describe('foresight document path resolution', () => {
  it('keeps a resolved path under the uploads root', () => {
    const full = resolveForesightDocumentPath('/srv/uploads', 'national-life/foresight/a/b.pdf')
    expect(full).toBe('/srv/uploads/national-life/foresight/a/b.pdf')
  })

  it('refuses a key that climbs out of the root', () => {
    // `join` aceita `..` de bom grado. Hoje as chaves são nossas; a checagem é
    // para quando a origem delas mudar.
    expect(() => resolveForesightDocumentPath('/srv/uploads', '../../etc/passwd')).toThrow()
    expect(() => resolveForesightDocumentPath('/srv/uploads', 'a/../../../etc')).toThrow()
    // A raiz nua também: escrever *em cima* do diretório não é um documento.
    expect(() => resolveForesightDocumentPath('/srv/uploads', '')).toThrow()
  })

  it('contains an absolute-looking key instead of honoring it', () => {
    // `join` trata a chave como relativa, então isto não escapa — mas o
    // comportamento merece estar escrito, e não ser descoberto de novo.
    expect(resolveForesightDocumentPath('/srv/uploads', '/etc/passwd')).toBe(
      '/srv/uploads/etc/passwd',
    )
  })
})

describe('foresight document round trip', () => {
  it('writes and reads back the same bytes, creating directories on the way', async () => {
    const key = foresightDocumentKey('case-1', 'foresight-report')
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])

    await writeForesightDocument(dir, key, bytes)

    expect(new Uint8Array(await readForesightDocument(dir, key))).toEqual(bytes)
    expect(new Uint8Array(await readFile(join(dir, key)))).toEqual(bytes)
  })

  it('overwrites in place when the same report is rendered again', async () => {
    const key = foresightDocumentKey('case-1', 'foresight-report')

    await writeForesightDocument(dir, key, new Uint8Array([1, 2, 3]))
    await writeForesightDocument(dir, key, new Uint8Array([9]))

    expect(new Uint8Array(await readForesightDocument(dir, key))).toEqual(new Uint8Array([9]))
  })
})

describe('foresight documents directory', () => {
  it('follows UPLOADS_DIR, the same volume the policy documents already use', () => {
    const original = process.env.UPLOADS_DIR
    try {
      process.env.UPLOADS_DIR = '/data/uploads'
      expect(foresightDocumentsDir()).toBe('/data/uploads')
      delete process.env.UPLOADS_DIR
      expect(foresightDocumentsDir()).toBe('./uploads')
    } finally {
      if (original === undefined) delete process.env.UPLOADS_DIR
      else process.env.UPLOADS_DIR = original
    }
  })
})
