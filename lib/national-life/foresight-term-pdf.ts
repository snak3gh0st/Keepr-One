import 'server-only'

const MAX_PREMIUM = 100_000_000

function money(value: string): number | null {
  if (!/^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(value)) return null
  const amount = Number(value.replaceAll(',', ''))
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_PREMIUM
    ? amount
    : null
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.map((value) => value.toFixed(2)))].map(Number)
}

export function parseForesightTermPremiumText(text: string): {
  monthlyPremium: number
  annualPremium: number
} {
  const normalized = text.replace(/\s+/g, ' ').trim()
  // pdfjs preserves the words but not the carrier's exact spacing. In
  // particular, Foresight may insert spaces around "$", parentheses or the
  // Group Bill slash. Match that layout variance, while still requiring one
  // unique summary and one unique annualized payment row below.
  const monthlyEft = String.raw`Monthly\s*\(\s*EFT(?:\s*\/\s*Group\s*Bill)?\s*\)`
  const summary = uniqueNumbers(
    [...normalized.matchAll(new RegExp(String.raw`Initial\s+Premium\s*:\s*\$\s*([\d,]+\.\d{2})\s+${monthlyEft}`, 'gi'))]
      .map((match) => money(match[1]!))
      .filter((value): value is number => value !== null),
  )
  const paymentRows = [...normalized.matchAll(new RegExp(
    String.raw`${monthlyEft}\s+12\s+\$\s*([\d,]+\.\d{2})\s+\$\s*([\d,]+\.\d{2})`,
    'gi',
  ))].map((match) => ({
    monthlyPremium: money(match[1]!),
    annualPremium: money(match[2]!),
  })).filter((row): row is { monthlyPremium: number; annualPremium: number } =>
    row.monthlyPremium !== null && row.annualPremium !== null)
  const uniqueRows = new Map(paymentRows.map((row) => [
    `${row.monthlyPremium.toFixed(2)}:${row.annualPremium.toFixed(2)}`,
    row,
  ]))

  if (summary.length !== 1 || uniqueRows.size !== 1) {
    throw new Error('FORESIGHT_TERM_PREMIUM_MISSING')
  }
  const row = [...uniqueRows.values()][0]!
  if (Math.abs(summary[0]! - row.monthlyPremium) > 0.005 ||
    Math.abs((row.monthlyPremium * 12) - row.annualPremium) > 0.01) {
    throw new Error('FORESIGHT_TERM_PREMIUM_MISMATCH')
  }
  return row
}

export async function extractForesightTermPremiums(documentBytes: Uint8Array): Promise<{
  monthlyPremium: number
  annualPremium: number
}> {
  if (documentBytes.byteLength < 5 || documentBytes.byteLength > 25 * 1024 * 1024 ||
    new TextDecoder().decode(documentBytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('FORESIGHT_TERM_PDF_INVALID')
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: Uint8Array.from(documentBytes),
    useSystemFonts: true,
  })
  const pdf = await loadingTask.promise
  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
    }
    return parseForesightTermPremiumText(pages.join('\n'))
  } finally {
    await loadingTask.destroy()
  }
}
