import { createHash } from 'node:crypto'
import { basename } from 'node:path'

export const APPLICATION_DOCUMENT_TYPES = [
  'IDENTITY', 'AUTHORIZATION', 'FINANCIAL', 'REPLACEMENT', 'OTHER',
] as const
export type ApplicationDocumentType = (typeof APPLICATION_DOCUMENT_TYPES)[number]

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg'])
const MAX_APPLICATION_DOCUMENT_BYTES = 10 * 1024 * 1024

export function validateApplicationDocument(input: {
  type: string
  filename: string
  mimeType: string
  bytes: Uint8Array
}): {
  type: ApplicationDocumentType
  filename: string
  mimeType: string
  sizeBytes: number
  contentHash: string
} {
  if (!APPLICATION_DOCUMENT_TYPES.includes(input.type as ApplicationDocumentType)) {
    throw new Error('APPLICATION_DOCUMENT_CATEGORY_INVALID')
  }
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new Error('APPLICATION_DOCUMENT_TYPE_NOT_ALLOWED')
  }
  if (input.bytes.byteLength === 0) throw new Error('APPLICATION_DOCUMENT_EMPTY')
  if (input.bytes.byteLength > MAX_APPLICATION_DOCUMENT_BYTES) {
    throw new Error('APPLICATION_DOCUMENT_TOO_LARGE')
  }
  const filename = basename(input.filename)
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[_\.]+/, '')
    .slice(0, 160) || 'document'
  return {
    type: input.type as ApplicationDocumentType,
    filename,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
    contentHash: createHash('sha256').update(input.bytes).digest('hex'),
  }
}
