import 'server-only'

import ExcelJS from 'exceljs'

export const NATIONAL_LIFE_EXPORT_MAX_BYTES = 25 * 1024 * 1024
export const NATIONAL_LIFE_EXPORT_MAX_ROWS = 200_000
const MAX_COLUMNS = 128
const MAX_CELL_TEXT = 16 * 1024

export class NationalLifeExportWorkbookError extends Error {
  constructor(readonly code: 'EXPORT_FILE_INVALID' | 'EXPORT_SCHEMA_INVALID' | 'EXPORT_TOO_LARGE') {
    super(code)
  }
}

function cellText(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') return value.slice(0, MAX_CELL_TEXT)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) {
    return value.toLocaleDateString('en-US', { timeZone: 'UTC' })
  }
  if ('formula' in value) {
    const result = value.result
    return typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean'
      ? result
      : null
  }
  if ('text' in value && typeof value.text === 'string') return value.text.slice(0, MAX_CELL_TEXT)
  return String(value).slice(0, MAX_CELL_TEXT)
}

function findHeaderRow(sheet: ExcelJS.Worksheet): { rowNumber: number; headers: string[] } {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const headers = Array.from({ length: Math.min(row.cellCount, MAX_COLUMNS) }, (_, index) =>
      String(cellText(row.getCell(index + 1).value) ?? '').trim(),
    )
    if (headers.includes('Policy #') && headers.includes('Owner') && headers.includes('Product')) {
      const nonEmpty = headers.filter(Boolean)
      if (new Set(nonEmpty).size !== nonEmpty.length) {
        throw new NationalLifeExportWorkbookError('EXPORT_SCHEMA_INVALID')
      }
      return { rowNumber, headers }
    }
  }
  throw new NationalLifeExportWorkbookError('EXPORT_SCHEMA_INVALID')
}

export async function parseNationalLifeInforceExport(bytes: Uint8Array): Promise<{
  worksheetName: string
  rows: Record<string, unknown>[]
}> {
  if (bytes.byteLength === 0 || bytes.byteLength > NATIONAL_LIFE_EXPORT_MAX_BYTES) {
    throw new NationalLifeExportWorkbookError('EXPORT_TOO_LARGE')
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new NationalLifeExportWorkbookError('EXPORT_FILE_INVALID')
  }

  const workbook = new ExcelJS.Workbook()
  try {
    // ExcelJS 4's declaration still refers to its pre-generic Buffer type,
    // while current @types/node exposes Buffer<ArrayBuffer>. Runtime accepts the
    // same Node Buffer; keep the compatibility cast at this library boundary.
    await workbook.xlsx.load(Buffer.from(bytes) as never)
  } catch {
    throw new NationalLifeExportWorkbookError('EXPORT_FILE_INVALID')
  }
  if (workbook.worksheets.length !== 1) {
    throw new NationalLifeExportWorkbookError('EXPORT_SCHEMA_INVALID')
  }
  const sheet = workbook.worksheets[0]!
  const { rowNumber: headerRow, headers } = findHeaderRow(sheet)
  const rows: Record<string, unknown>[] = []
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    if (rows.length >= NATIONAL_LIFE_EXPORT_MAX_ROWS) {
      throw new NationalLifeExportWorkbookError('EXPORT_TOO_LARGE')
    }
    const row = sheet.getRow(rowNumber)
    const record: Record<string, unknown> = {}
    let populated = false
    for (let column = 0; column < headers.length; column += 1) {
      const header = headers[column]
      if (!header) continue
      const value = cellText(row.getCell(column + 1).value)
      record[header] = value
      if (value !== null) populated = true
    }
    if (populated) rows.push(record)
  }
  return { worksheetName: sheet.name, rows }
}
