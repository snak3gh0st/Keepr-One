import { describe, expect, it } from 'vitest'
import { csvCell, marketingLeadsCsv } from './csv'

describe('marketing CSV', () => {
  it.each(['=HYPERLINK("https://bad.test")', '+12125550100', '-1+1', '@SUM(A1)', '  =1+1', '\ttext', '\rtext', '\ufeff=1+1'])('neutralizes spreadsheet prefix %j', (value) => {
    expect(csvCell(value).startsWith('"\'')).toBe(true)
  })
  it('escapes quotes, delimiters and multiline text without destroying Unicode', () => {
    expect(csvCell('Ana, "João"\nKeepr')).toBe('"Ana, ""João""\nKeepr"')
    expect(csvCell(null)).toBe('""')
    expect(marketingLeadsCsv([])).toMatch(/^\ufeff"ID","Nome"/)
    expect(marketingLeadsCsv([]).endsWith('\r\n')).toBe(true)
  })
})
