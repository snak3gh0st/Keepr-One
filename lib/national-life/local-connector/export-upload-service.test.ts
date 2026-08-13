import { describe, expect, it } from 'vitest'
import {
  NATIONAL_LIFE_EXPORT_CHUNK_BYTES,
  NationalLifeExportUploadError,
  exportChunkLayout,
} from './export-upload-service'

describe('National Life export upload layout', () => {
  it('keeps every binary chunk at or below one MiB', () => {
    const bytes = NATIONAL_LIFE_EXPORT_CHUNK_BYTES * 2 + 17
    expect(exportChunkLayout(bytes, 0)).toMatchObject({ byteOffset: 0, byteLength: NATIONAL_LIFE_EXPORT_CHUNK_BYTES, totalChunks: 3 })
    expect(exportChunkLayout(bytes, 1)).toMatchObject({ byteOffset: NATIONAL_LIFE_EXPORT_CHUNK_BYTES, byteLength: NATIONAL_LIFE_EXPORT_CHUNK_BYTES })
    expect(exportChunkLayout(bytes, 2)).toMatchObject({ byteOffset: NATIONAL_LIFE_EXPORT_CHUNK_BYTES * 2, byteLength: 17 })
  })

  it('refuses a sequence outside the declared file', () => {
    expect(() => exportChunkLayout(10, 1)).toThrowError(NationalLifeExportUploadError)
  })
})
