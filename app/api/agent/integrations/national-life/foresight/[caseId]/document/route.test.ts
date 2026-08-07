import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/prisma', () => ({
  prisma: { nationalLifeForesightDocument: { findFirst: mocks.findFirst } },
}))
vi.mock('@/lib/national-life/env', () => ({
  isNationalLifeConfigured: () => true,
  getNationalLifeEnv: () => ({ sessionScopeId: 'scope-1' }),
}))

import {
  foresightDocumentKey,
  writeForesightDocument,
} from '@/lib/national-life/foresight-document-storage'
import { GET } from './route'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46])
const LEGACY = new Uint8Array([0x6c, 0x65, 0x67])

let uploadsDir = ''
const originalUploadsDir = process.env.UPLOADS_DIR

function request() {
  return GET(new Request('https://app.keepr.one/doc'), {
    params: Promise.resolve({ caseId: 'case-1' }),
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
  uploadsDir = await mkdtemp(join(tmpdir(), 'foresight-route-'))
  process.env.UPLOADS_DIR = uploadsDir
})

afterEach(async () => {
  if (originalUploadsDir === undefined) delete process.env.UPLOADS_DIR
  else process.env.UPLOADS_DIR = originalUploadsDir
  await rm(uploadsDir, { recursive: true, force: true })
})

describe('Foresight document download', () => {
  it('serves a row that only has a storage key', async () => {
    // Este é o estado normal depois desta mudança: `bytes` nulo. Uma rota que
    // esquecesse de selecionar `storageKey` cairia sempre no ramo antigo e daria
    // 404 em todo download, com todos os testes de linha ainda passando.
    const key = foresightDocumentKey('case-1', 'foresight-report')
    await writeForesightDocument(uploadsDir, key, PDF)
    mocks.findFirst.mockResolvedValue({
      bytes: null,
      storageKey: key,
      mimeType: 'application/pdf',
      filename: 'relatorio.pdf',
    })

    const response = await request()

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('asks the database for the storage key', async () => {
    // Sem esta asserção o `select` é a única parte da rota que nenhum teste
    // alcança: o mock devolve a linha que eu escrevi, não a que a cláusula
    // pediria. Esquecer `storageKey` ali faria todo download cair no ramo
    // antigo — que é nulo depois do backfill — e dar 404, com todos os outros
    // testes desta suíte ainda verdes.
    mocks.findFirst.mockResolvedValue(null)

    await request()

    expect(mocks.findFirst.mock.calls[0]?.[0].select).toMatchObject({
      bytes: true,
      storageKey: true,
      mimeType: true,
      filename: true,
    })
  })

  it('still serves a row the backfill has not moved yet', async () => {
    mocks.findFirst.mockResolvedValue({
      bytes: LEGACY,
      storageKey: null,
      mimeType: 'application/pdf',
      filename: 'antigo.pdf',
    })

    const response = await request()

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(LEGACY)
  })

  it('prefers the file over stale bytes when both are present', async () => {
    // Só acontece se algo escrever os dois. Preferir o disco é a mesma ordem que
    // o backfill usa — o arquivo é a cópia nova.
    const key = foresightDocumentKey('case-1', 'foresight-report')
    await writeForesightDocument(uploadsDir, key, PDF)
    mocks.findFirst.mockResolvedValue({
      bytes: LEGACY,
      storageKey: key,
      mimeType: 'application/pdf',
      filename: 'ambos.pdf',
    })

    const response = await request()

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF)
  })

  it('answers 404 when the key points at a file that is not there', async () => {
    mocks.findFirst.mockResolvedValue({
      bytes: null,
      storageKey: foresightDocumentKey('case-1', 'sumiu'),
      mimeType: 'application/pdf',
      filename: 'sumiu.pdf',
    })

    expect((await request()).status).toBe(404)
  })

  it('answers 404 when the row carries neither bytes nor key', async () => {
    mocks.findFirst.mockResolvedValue({
      bytes: null,
      storageKey: null,
      mimeType: 'application/pdf',
      filename: 'vazio.pdf',
    })

    expect((await request()).status).toBe(404)
  })

  it('answers 404 when no document is owned by this agent', async () => {
    mocks.findFirst.mockResolvedValue(null)

    expect((await request()).status).toBe(404)
  })
})
