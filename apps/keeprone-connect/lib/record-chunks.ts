import type { RawGridRow } from './messages'
import { PAGE_SIZE } from './paging'

/// The server accepts at most 2 MiB for the complete signed envelope. Page
/// snapshots can contain 12 KiB text records, so the grid-only rule of 200 rows
/// is not sufficient. Keeping record JSON under 1.5 MB leaves roughly 0.5 MiB
/// for envelope fields, escaping differences, and future metadata.
export const MAX_RECORD_CHUNK_JSON_BYTES = 1_500_000

const encoder = new TextEncoder()

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

export function chunkRecordsForUpload(
  records: readonly RawGridRow[],
  options: { maxRecords?: number; maxJsonBytes?: number } = {},
): RawGridRow[][] {
  const maxRecords = options.maxRecords ?? PAGE_SIZE
  const maxJsonBytes = options.maxJsonBytes ?? MAX_RECORD_CHUNK_JSON_BYTES
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxJsonBytes < 2) {
    throw new Error('INVALID_CHUNK_BUDGET')
  }
  if (records.length === 0) return [[]]

  const chunks: RawGridRow[][] = []
  let current: RawGridRow[] = []
  let currentBytes = 2 // JSON array brackets.

  for (const record of records) {
    const recordBytes = jsonBytes(record)
    const addedBytes = recordBytes + (current.length > 0 ? 1 : 0)
    if (recordBytes + 2 > maxJsonBytes) throw new Error('PAGE_RECORD_TOO_LARGE')
    if (current.length >= maxRecords || currentBytes + addedBytes > maxJsonBytes) {
      chunks.push(current)
      current = []
      currentBytes = 2
    }
    current.push(record)
    currentBytes += recordBytes + (current.length > 1 ? 1 : 0)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}
