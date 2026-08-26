export const FORESIGHT_REPORT_MAX_BYTES = 25 * 1024 * 1024

export function parseForesightReportUrl(value: string, origin: string): URL | null {
  let url: URL
  try {
    url = new URL(value, origin)
  } catch {
    return null
  }
  const keys = [...url.searchParams.keys()].sort()
  return url.origin === origin && url.pathname === '/NWI/Main/ReportDisplay.rspx' &&
    JSON.stringify(keys) === JSON.stringify(['NavToRptStream', 'SessionTokenId']) &&
    url.searchParams.get('NavToRptStream') === 'yes' && Boolean(url.searchParams.get('SessionTokenId'))
    ? url : null
}

export function isForesightPdf(contentType: string | null, bytes: Uint8Array): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/pdf' &&
    bytes.length >= 5 && bytes.length <= FORESIGHT_REPORT_MAX_BYTES &&
    new TextDecoder('ascii').decode(bytes.subarray(0, 5)) === '%PDF-'
}
