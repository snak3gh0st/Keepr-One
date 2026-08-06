import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  nationalLifeForesightCaseSnapshot: { upsert: vi.fn() },
  nationalLifeForesightServiceSnapshot: { upsert: vi.fn() },
  nationalLifeForesightDocument: { upsert: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: repository }))

import {
  upsertForesightCaseSnapshot,
  upsertForesightDocument,
  upsertForesightServiceSnapshot,
} from './foresight-snapshot-service'
import { foresightDocumentKey } from './foresight-document-storage'

const observedAt = new Date('2026-08-03T17:00:00.000Z')
const ownership = {
  agentId: 'agent-1',
  deploymentScope: 'scope-1',
  provider: 'NATIONAL_LIFE',
}

const documentInput = {
  ...ownership,
  caseSnapshotId: 'case-1',
  reportKey: 'illustration',
  filename: 'illustration.pdf',
  mimeType: 'application/pdf',
  byteSize: 3,
  contentHash: 'abc',
  bytes: Buffer.from('pdf'),
  renderState: 'RENDERED',
  safeErrorCode: null,
  fetchedAt: observedAt,
}

let uploadsDir = ''
const originalUploadsDir = process.env.UPLOADS_DIR

describe('Foresight snapshot persistence', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Sem isto os testes escreveriam PDFs em `./uploads` do repositório.
    uploadsDir = await mkdtemp(join(tmpdir(), 'foresight-snapshot-'))
    process.env.UPLOADS_DIR = uploadsDir
  })

  afterEach(async () => {
    if (originalUploadsDir === undefined) delete process.env.UPLOADS_DIR
    else process.env.UPLOADS_DIR = originalUploadsDir
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('keys a case snapshot by its direct ownership tuple and redacts its raw payload', async () => {
    repository.nationalLifeForesightCaseSnapshot.upsert.mockResolvedValue({ id: 'case-1' })

    await expect(
      upsertForesightCaseSnapshot({
        ...ownership,
        externalKey: 'foresight-case-1',
        displayName: 'Visible case',
        caseKind: 'CASE',
        product: 'IUL',
        status: 'IN_PROGRESS',
        state: 'OPEN',
        observedAt,
        raw: { token: 'secret', premium: 250 },
      }),
    ).resolves.toEqual({ id: 'case-1' })

    expect(repository.nationalLifeForesightCaseSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          agentId_deploymentScope_provider_externalKey: {
            ...ownership,
            externalKey: 'foresight-case-1',
          },
        },
      }),
    )
    expect(repository.nationalLifeForesightCaseSnapshot.upsert.mock.calls[0]?.[0].create.raw).toEqual({
      token: '[REDACTED]',
      premium: 250,
    })
  })

  it('cannot match another agent case when updating the same external key', async () => {
    repository.nationalLifeForesightCaseSnapshot.upsert.mockResolvedValue({ id: 'case-1' })

    await upsertForesightCaseSnapshot({
      ...ownership,
      externalKey: 'shared-carrier-key',
      displayName: 'Agent one case',
      caseKind: null,
      product: null,
      status: null,
      state: null,
      observedAt,
      raw: {},
    })
    await upsertForesightCaseSnapshot({
      ...ownership,
      agentId: 'agent-2',
      externalKey: 'shared-carrier-key',
      displayName: 'Agent two case',
      caseKind: null,
      product: null,
      status: null,
      state: null,
      observedAt,
      raw: {},
    })

    const calls = repository.nationalLifeForesightCaseSnapshot.upsert.mock.calls
    expect(calls[0]?.[0].where).not.toEqual(calls[1]?.[0].where)
    expect(calls[1]?.[0].where).toEqual({
      agentId_deploymentScope_provider_externalKey: {
        ...ownership,
        agentId: 'agent-2',
        externalKey: 'shared-carrier-key',
      },
    })
  })

  it('keys service snapshots by case and service name', async () => {
    repository.nationalLifeForesightServiceSnapshot.upsert.mockResolvedValue({ id: 'service-1' })

    await upsertForesightServiceSnapshot({
      ...ownership,
      caseSnapshotId: 'case-1',
      serviceName: 'WidgetService.asmx/GetState',
      payloadShape: { state: 'string(5)' },
      payload: { email: 'agent@example.com', state: 'OPEN' },
      validationState: 'VALID',
      observedAt,
    })

    expect(repository.nationalLifeForesightServiceSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          caseSnapshotId_serviceName: {
            caseSnapshotId: 'case-1',
            serviceName: 'WidgetService.asmx/GetState',
          },
        },
      }),
    )
    expect(repository.nationalLifeForesightServiceSnapshot.upsert.mock.calls[0]?.[0].create.payload).toEqual({
      email: '[REDACTED]',
      state: 'OPEN',
    })
  })

  it('keys documents by case and report key', async () => {
    repository.nationalLifeForesightDocument.upsert.mockResolvedValue({ id: 'document-1' })

    await upsertForesightDocument({
      ...ownership,
      caseSnapshotId: 'case-1',
      reportKey: 'illustration',
      filename: 'illustration.pdf',
      mimeType: 'application/pdf',
      byteSize: 3,
      contentHash: 'abc',
      bytes: Buffer.from('pdf'),
      renderState: 'RENDERED',
      safeErrorCode: null,
      fetchedAt: observedAt,
    })

    expect(repository.nationalLifeForesightDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          caseSnapshotId_reportKey: { caseSnapshotId: 'case-1', reportKey: 'illustration' },
        },
      }),
    )
  })

  it('grava o PDF em disco e não deixa bytes no banco', async () => {
    repository.nationalLifeForesightDocument.upsert.mockResolvedValue({ id: 'document-1' })

    await upsertForesightDocument({ ...documentInput, bytes: Buffer.from('pdf') })

    const call = repository.nationalLifeForesightDocument.upsert.mock.calls[0]?.[0]
    const key = foresightDocumentKey('case-1', 'illustration')
    expect(call.create).toMatchObject({ storageKey: key, bytes: null })
    // O `null` no update importa tanto quanto no create: sem ele, rerrenderizar
    // uma linha antiga deixaria o PDF velho no banco e o novo em disco, e a
    // leitura — que prefere o disco só quando há storageKey — serviria o velho.
    expect(call.update).toMatchObject({ storageKey: key, bytes: null })
    expect(await readFile(join(uploadsDir, key), 'utf8')).toBe('pdf')
  })

  it('escreve o arquivo antes da linha', async () => {
    let fileExistedAtUpsert = false
    const key = foresightDocumentKey('case-1', 'illustration')
    repository.nationalLifeForesightDocument.upsert.mockImplementation(async () => {
      fileExistedAtUpsert = existsSync(join(uploadsDir, key))
      return { id: 'document-1' }
    })

    await upsertForesightDocument({ ...documentInput, bytes: Buffer.from('pdf') })

    // Arquivo sem linha é invisível: ninguém o procura. Linha sem arquivo é um
    // download que dá 404 com o banco jurando que o documento existe.
    expect(fileExistedAtUpsert).toBe(true)
  })

  it('não grava a linha quando o disco recusa o arquivo', async () => {
    repository.nationalLifeForesightDocument.upsert.mockResolvedValue({ id: 'document-1' })
    process.env.UPLOADS_DIR = join(uploadsDir, 'arquivo-no-lugar-de-pasta')
    await writeFile(process.env.UPLOADS_DIR, 'não sou diretório')

    await expect(
      upsertForesightDocument({ ...documentInput, bytes: Buffer.from('pdf') }),
    ).rejects.toThrow()

    expect(repository.nationalLifeForesightDocument.upsert).not.toHaveBeenCalled()
  })
})
