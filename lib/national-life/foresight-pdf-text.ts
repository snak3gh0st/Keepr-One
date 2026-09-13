import 'server-only'

const MAX_PDF_BYTES = 25 * 1024 * 1024

/// Reads a carrier PDF into one string per page.
///
/// The loader lives here rather than beside any one parser because two
/// different readers now need it — the premium verification that gates a Term
/// result, and the ledger the client-facing document is drawn from — and each
/// needed the same handful of server-side workarounds to get pdfjs running
/// outside a browser.
export async function foresightPdfPages(documentBytes: Uint8Array): Promise<string[]> {
  if (documentBytes.byteLength < 5 || documentBytes.byteLength > MAX_PDF_BYTES ||
    new TextDecoder().decode(documentBytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('FORESIGHT_PDF_INVALID')
  }
  // PDF.js needs these primitives while reading certain production PDFs. They
  // are supplied explicitly so the standalone server image does not depend on
  // an optional transitive package being present at runtime.
  const canvas = await import('@napi-rs/canvas')
  const runtime = globalThis as unknown as Record<string, unknown>
  runtime.DOMMatrix ??= canvas.DOMMatrix
  runtime.Path2D ??= canvas.Path2D
  // The Next server bundle cannot resolve PDF.js' relative fake-worker import.
  // Providing the official worker handler up front keeps text extraction in
  // process and avoids a browser-style worker dependency on the server.
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  runtime.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler }
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
    return pages
  } finally {
    await loadingTask.destroy()
  }
}
