import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { completeLocalConnectorStage, ingestLocalConnectorStage } from '@/lib/national-life/local-connector/run-service'
import { LOCAL_CONNECTOR_SCHEMA_VERSION } from '@/lib/national-life/local-connector/contracts'
import { requestNationalLifeDocumentTransfer, declareNationalLifeDocumentTransfer,
  putNationalLifeDocumentChunk, completeNationalLifeDocumentTransfer } from '@/lib/national-life/local-connector/document-transfer-service'

// Explicit opt-in against a disposable local database; never use DATABASE_URL.
const url = process.env.NATIONAL_REPORT_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/keeprone_audit_test') {
    throw new Error('Report integration tests require the disposable local audit database')
  }
}

describe.skipIf(!url)('verified report publication in PostgreSQL', () => {
  let db: PrismaClient
  const suffix = randomUUID()
  const agentId = `agent-${suffix}`
  const userId = `user-${suffix}`
  const baseTime = new Date('2026-09-04T20:00:00Z')
  const gridKey = 'PAYABLE_GROSS_COMMISSIONS' as const

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } })
    await db.user.create({ data: { id: userId, name: 'Synthetic Audit', email: `${suffix}@example.invalid`, role: 'AGENT' } })
    await db.agent.create({ data: { id: agentId, userId, rank: 'AGENT' } })
  })
  afterAll(async () => {
    await db.policyDocument.deleteMany({ where: { policy: { agentId } } })
    await db.policy.deleteMany({ where: { agentId } })
    await db.client.deleteMany({ where: { assignedAgentId: agentId } })
    await db.agent.delete({ where: { id: agentId } })
    await db.user.delete({ where: { id: userId } })
    await db.$disconnect()
  })

  async function source(label: string) {
    const device = await db.nationalLifeConnectorDevice.create({ data: {
      agentId, label, publicKeyJwk: {}, publicKeyThumbprint: randomUUID(),
    } })
    const run = await db.nationalLifeSyncRun.create({ data: {
      agentId, connectorDeviceId: device.id, deploymentScope: 'LOCAL_CONNECTOR',
      executionSource: 'LOCAL', state: 'RUNNING', totalStages: 2,
      plannedGridKeys: [gridKey, 'INFORCE_CLIENTS'],
    } })
    const scope = { agentId, deviceId: device.id, runId: run.id, gridKey }
    const upload = (sequence: number) => ingestLocalConnectorStage(db, {
      ...scope, contentHash: `${label}-${sequence}`, idempotencyKey: `${run.id}-${sequence}`,
      envelope: { schemaVersion: LOCAL_CONNECTOR_SCHEMA_VERSION, runId: run.id, gridKey,
        sequence, observedAt: baseTime.toISOString(), truncated: false, recordsTotal: 1,
        records: [{ PolicyNumber: label, NLLifeAmount: '100' }] },
    })
    await upload(0)
    return { scope, upload }
  }

  const finish = (scope: Awaited<ReturnType<typeof source>>['scope'], offset: number) =>
    completeLocalConnectorStage(db, { ...scope, expectedRecordCount: 1,
      finalSequence: 0, truncated: false, now: new Date(baseTime.getTime() + offset) })

  it('keeps B intact after A retries, and refuses new pages for the sealed A stage', async () => {
    const a = await source('A')
    const b = await source('B')
    await finish(a.scope, 0)
    await finish(b.scope, 1000)
    await finish(a.scope, 2000)
    const rows = await db.nationalLifePublishedReportRow.findMany({ where: { agentId, gridKey } })
    expect(rows).toHaveLength(1)
    expect(rows[0].runId).toBe(b.scope.runId)
    expect(rows[0].raw).toMatchObject({ PolicyNumber: 'B' })
    await expect(a.upload(1)).rejects.toThrow('RUN_NOT_ACTIVE')
    expect(await db.nationalLifeRawGridPage.count({ where: { agentId } })).toBe(2)
  })

  it('serializes simultaneous publishers without mixing their row sets', async () => {
    const c = await source('C')
    const d = await source('D')
    await Promise.all([finish(c.scope, 3000), finish(d.scope, 4000)])
    const rows = await db.nationalLifePublishedReportRow.findMany({ where: { agentId, gridKey } })
    expect(rows).toHaveLength(1)
    expect(rows[0].runId).toBe(d.scope.runId)
    const before = rows[0].fetchedAt
    await Promise.all([finish(d.scope, 5000), finish(d.scope, 6000)])
    expect((await db.nationalLifePublishedReportRow.findMany({ where: { agentId, gridKey } }))[0].fetchedAt).toEqual(before)
  })

  it('retrieves a published correspondence document through the new foreign keys', async () => {
    const { scope } = await source('DOCUMENT')
    const policyNumber = `LS${Date.now()}`
    const client = await db.client.create({ data: { assignedAgentId: agentId, name: 'Synthetic Client' } })
    const policy = await db.policy.create({ data: { agentId, clientId: client.id,
      policyNumber, carrier: 'National Life', product: 'Test', status: 'INFORCE' } })
    const row = await db.nationalLifePublishedReportRow.create({ data: {
      agentId, deploymentScope: 'LOCAL_CONNECTOR', gridKey: 'CORRESPONDENCE',
      rowKey: randomUUID(), amounts: {}, raw: { RefPolicyNumber: policyNumber,
        EncryptedDocumentHandle: 'ZW5jcnlwdGVkLWNhcnJpZXItaGFuZGxlLTEyMw==' },
      fetchedAt: baseTime, stageCompletionId: randomUUID(), runId: scope.runId, deviceId: scope.deviceId,
    } })
    const requested = await requestNationalLifeDocumentTransfer(db, { ...scope, reportRowId: row.id })
    if (requested.completed) throw new Error('Expected a new transfer')
    const input = { ...scope, transferId: requested.transferId }
    const bytes = Buffer.from('%PDF-1.4\nSynthetic document\n%%EOF')
    await declareNationalLifeDocumentTransfer(db, { ...input, contentType: 'application/pdf',
      expectedBytes: bytes.length, expectedSha256: createHash('sha256').update(bytes).digest('hex') })
    await putNationalLifeDocumentChunk(db, { ...input, sequence: 0, bytes })
    const folder = await mkdtemp(join(tmpdir(), 'keeprone-document-test-'))
    const previous = process.env.UPLOADS_DIR
    process.env.UPLOADS_DIR = folder
    try {
      const result = await completeNationalLifeDocumentTransfer(db, input)
      const stored = await db.policyDocument.findUniqueOrThrow({ where: { id: result.documentId } })
      expect(stored).toMatchObject({ policyId: policy.id, publishedSourceRowId: row.id, sourceRowId: null })
      expect(await readFile(join(folder, stored.storedPath))).toEqual(bytes)
      await expect(requestNationalLifeDocumentTransfer(db, { ...scope, reportRowId: row.id }))
        .resolves.toEqual({ completed: true, documentId: stored.id })
    } finally {
      if (previous === undefined) delete process.env.UPLOADS_DIR
      else process.env.UPLOADS_DIR = previous
      await rm(folder, { recursive: true, force: true })
    }
  })
})
