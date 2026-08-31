const REPORTS_CONTAINER_SELECTOR = 'div[id$="_divReports"]'
export const FORESIGHT_TERM_OPTIONAL_REPORT_SELECTOR =
  'input[type="checkbox"][id*="rptOptionalReports"][id$="_chkOptional"]'

export function foresightTermReportGroupText(checkbox: HTMLInputElement): string {
  const reports = checkbox.closest<HTMLElement>(REPORTS_CONTAINER_SELECTOR)
  return reports?.parentElement?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

export function isForesightTermNaicReportGroup(
  checkbox: HTMLInputElement,
  duration: string,
): boolean {
  const text = foresightTermReportGroupText(checkbox)
  return text.includes(`Term ${duration}`) && text.includes('NAIC Illustration')
}
