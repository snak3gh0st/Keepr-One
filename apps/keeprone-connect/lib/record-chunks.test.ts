import { describe, expect, it } from 'vitest'
import { chunkRecordsForUpload, MAX_RECORD_CHUNK_JSON_BYTES } from './record-chunks'

const encoder = new TextEncoder()

describe('record upload chunks', () => {
  it('splits large page records by bytes before the request body can reach 2 MiB', () => {
    const records = Array.from({ length: 200 }, (_, index) => ({
      RecordType: 'PAGE_TEXT',
      ChunkIndex: index,
      Text: 'x'.repeat(12_000),
    }))

    const chunks = chunkRecordsForUpload(records)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat()).toEqual(records)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200)
      expect(encoder.encode(JSON.stringify(chunk)).byteLength).toBeLessThanOrEqual(
        MAX_RECORD_CHUNK_JSON_BYTES,
      )
    }
  })

  it('still honors the 200-record server limit for small grid rows', () => {
    const records = Array.from({ length: 401 }, (_, index) => ({ index }))
    expect(chunkRecordsForUpload(records).map((chunk) => chunk.length)).toEqual([200, 200, 1])
  })
})
