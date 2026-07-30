/// Parser for portal reports that are server-rendered instead of served through
/// GetJsonResult. The premium report and the commission overview both fall in
/// this group: the numbers are already in the HTML and there is no JSON endpoint
/// to call.
export type RenderedTable = {
  headers: string[]
  rows: Array<Record<string, string>>
}

function stripTags(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function cellsOf(rowHtml: string, tag: 'th' | 'td'): string[] {
  const pattern = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi')
  return (rowHtml.match(pattern) ?? []).map(stripTags)
}

/// Extracts the nth table. Headers are taken from the first row that has <th>
/// cells; every later row with <td> cells becomes a record keyed by header.
///
/// Duplicate headers are suffixed rather than dropped — the premium report has
/// two different columns both labelled "Total", and silently keeping one would
/// lose a real figure.
export function parseRenderedTable(html: string, index = 0): RenderedTable | null {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? []
  const table = tables[index]
  if (!table) {
    return null
  }

  const rowsHtml = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
  let headers: string[] = []
  const rows: Array<Record<string, string>> = []

  for (const rowHtml of rowsHtml) {
    const headerCells = cellsOf(rowHtml, 'th')
    if (headers.length === 0 && headerCells.length > 0) {
      const seen = new Map<string, number>()
      headers = headerCells.map((header) => {
        const base = header || 'coluna'
        const count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        return count === 0 ? base : `${base} (${count + 1})`
      })
      continue
    }

    const cells = cellsOf(rowHtml, 'td')
    if (cells.length === 0) {
      continue
    }
    const record: Record<string, string> = {}
    cells.forEach((cell, position) => {
      record[headers[position] ?? `coluna ${position + 1}`] = cell
    })
    // A row of blanks carries nothing.
    if (Object.values(record).some((value) => value.length > 0)) {
      rows.push(record)
    }
  }

  return headers.length > 0 || rows.length > 0 ? { headers, rows } : null
}

// A bare integer is not money: the premium report's first column is a year, and
// treating "2026" as an amount would invent a figure. Require a currency symbol,
// decimal places, or thousands grouping.
const CURRENCY = /^-?\(?\$?\s*[\d,]+(\.\d+)?\)?$/
const LOOKS_LIKE_MONEY = /[$,]|\.\d{2}\)?$/

/// Cells that hold money, so a report's figures can be surfaced without knowing
/// each report's column names in advance.
export function monetaryCells(row: Record<string, string>): Record<string, string> {
  const amounts: Record<string, string> = {}
  for (const [key, value] of Object.entries(row)) {
    const trimmed = value.trim()
    if (trimmed && CURRENCY.test(trimmed) && LOOKS_LIKE_MONEY.test(trimmed)) {
      amounts[key] = trimmed
    }
  }
  return amounts
}
