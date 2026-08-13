import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  NationalLifeExportWorkbookError,
  parseNationalLifeInforceExport,
} from './export-workbook'

async function workbookBytes() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('InforceClientInfo_08132026')
  sheet.getRow(2).getCell(1).value = 'Inforce Client Information'
  sheet.getRow(6).values = [
    'Owner',
    'Insured / Annuitant',
    'Policy #',
    'Type',
    'Product',
    'Status',
    'Owner Email',
    'Anticipated Annual Premium',
  ]
  sheet.getRow(7).values = [
    'Owner Name',
    'Insured Name',
    'NL-1',
    'Life',
    'FlexLife',
    'Active',
    'owner@example.com',
    2400,
  ]
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

describe('National Life official export workbook', () => {
  it('finds the carrier header and returns faithful rows', async () => {
    await expect(parseNationalLifeInforceExport(await workbookBytes())).resolves.toMatchObject({
      worksheetName: 'InforceClientInfo_08132026',
      rows: [{
        Owner: 'Owner Name',
        'Policy #': 'NL-1',
        'Owner Email': 'owner@example.com',
        'Anticipated Annual Premium': 2400,
      }],
    })
  })

  it('rejects a non-XLSX payload before parsing', async () => {
    await expect(parseNationalLifeInforceExport(new TextEncoder().encode('<html>login</html>')))
      .rejects.toMatchObject({ code: 'EXPORT_FILE_INVALID' } satisfies Partial<NationalLifeExportWorkbookError>)
  })
})
