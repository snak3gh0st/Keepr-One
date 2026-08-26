import { describe, expect, it } from 'vitest'
import { isForesightPdf, parseForesightReportUrl } from './foresight-report'

const origin = 'https://www.nationallife.com'

describe('Foresight report stream boundary', () => {
  it('accepts only the exact same-origin one-time report stream', () => {
    expect(parseForesightReportUrl(
      `${origin}/NWI/Main/ReportDisplay.rspx?NavToRptStream=yes&SessionTokenId=session`, origin,
    )?.pathname).toBe('/NWI/Main/ReportDisplay.rspx')
    expect(parseForesightReportUrl(
      `https://evil.example/NWI/Main/ReportDisplay.rspx?NavToRptStream=yes&SessionTokenId=session`, origin,
    )).toBeNull()
    expect(parseForesightReportUrl(
      `${origin}/NWI/Main/ReportDisplay.rspx?NavToRptStream=yes&SessionTokenId=session&extra=1`, origin,
    )).toBeNull()
  })

  it('accepts only bounded PDF bytes with the PDF signature', () => {
    expect(isForesightPdf('application/pdf; charset=binary', new TextEncoder().encode('%PDF-1.7\n'))).toBe(true)
    expect(isForesightPdf('text/html', new TextEncoder().encode('%PDF-1.7\n'))).toBe(false)
    expect(isForesightPdf('application/pdf', new TextEncoder().encode('<html>login</html>'))).toBe(false)
  })
})
