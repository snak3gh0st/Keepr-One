import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const observedAt = new Date('2026-08-03T17:00:00.000Z')
const ownership = {
  agentId: 'agent-1',
  deploymentScope: 'scope-1',
  provider: 'NATIONAL_LIFE',
}

describe('Foresight snapshot persistence', () => {
  beforeEach(() => vi.clearAllMocks())

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
})
