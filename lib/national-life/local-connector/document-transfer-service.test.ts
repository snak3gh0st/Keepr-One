import { describe, expect, it, vi } from 'vitest'
import {
  documentChunkLayout,
  isEncryptedDocumentHandle,
  nationalLifeDocumentFileName,
  nationalLifeDocumentStorageKey,
  NationalLifeDocumentTransferError,
  requestNationalLifeDocumentTransfer,
} from './document-transfer-service'

describe('National Life correspondence document transfer', () => {
  it('uses the published document identity from the policy page and preserves tenant scope', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'published-1', rowKey: 'document-1', raw: {
      RefPolicyNumber: 'LS12345', EncryptedDocumentHandle: 'ZW5jcnlwdGVkLWNhcnJpZXItaGFuZGxlLTEyMw==',
    } })
    const upsert = vi.fn().mockResolvedValue({ id: 'transfer-1', state: 'REQUESTED', documentId: null })
    const db = {
      nationalLifePublishedReportRow: { findFirst },
      nationalLifeReportRow: { findFirst: vi.fn(() => { throw new Error('unverified landing read') }) },
      policy: { findFirst: vi.fn().mockResolvedValue({ id: 'policy-1', policyNumber: 'LS12345' }) },
      policyDocument: { findFirst: vi.fn().mockResolvedValue(null) },
      nationalLifeDocumentTransfer: { findUnique: vi.fn().mockResolvedValue(null), upsert },
    }
    await expect(requestNationalLifeDocumentTransfer(db as never, {
      agentId: 'owner', deviceId: 'device-1', reportRowId: 'published-1',
    })).resolves.toMatchObject({ completed: false, transferId: 'transfer-1' })
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: 'published-1', agentId: 'owner', deploymentScope: 'LOCAL_CONNECTOR', gridKey: 'CORRESPONDENCE',
    })
    expect(upsert.mock.calls[0][0].create).toMatchObject({ publishedReportRowId: 'published-1', agentId: 'owner' })
    expect(upsert.mock.calls[0][0].create).not.toHaveProperty('reportRowId')
  })

  it('accepts only bounded base64 carrier handles', () => {
    expect(isEncryptedDocumentHandle('ZW5jcnlwdGVkLWNhcnJpZXItaGFuZGxlLTEyMw==')).toBe(true)
    expect(isEncryptedDocumentHandle('../document.pdf')).toBe(false)
    expect(isEncryptedDocumentHandle('a'.repeat(2_052))).toBe(false)
  })

  it('builds a safe, deterministic carrier document destination', () => {
    expect(nationalLifeDocumentFileName({
      DocumentDate: '08/26/2026',
      DocumentType: '<a>Annual Statement / Notice</a>',
    }, 'LS0648595')).toBe('National-Life_LS0648595_08-26-2026_Annual_Statement___Notice.pdf')
    const storageKey = nationalLifeDocumentStorageKey('policy/../../1', 'row/../../2')
    expect(storageKey).toMatch(/^policies\/[A-Za-z0-9_-]+\/national-life\/[A-Za-z0-9_-]+\.pdf$/)
    expect(storageKey).not.toContain('..')
  })

  it('requires exact one-megabyte chunks except for the final remainder', () => {
    expect(documentChunkLayout(1024 * 1024 + 7, 0)).toEqual({
      totalChunks: 2,
      byteOffset: 0,
      byteLength: 1024 * 1024,
    })
    expect(documentChunkLayout(1024 * 1024 + 7, 1)).toEqual({
      totalChunks: 2,
      byteOffset: 1024 * 1024,
      byteLength: 7,
    })
    expect(() => documentChunkLayout(5, 1)).toThrowError(
      new NationalLifeDocumentTransferError('DOCUMENT_CHUNK_INVALID'),
    )
  })
})
