/// Decisions the Foresight report flow needs, kept out of the browser script so
/// they can be tested without a carrier session.

type ReportProgress = {
  Progress?: number
  IsComplete?: boolean
  HasException?: boolean
  IsAborting?: boolean
} | null

/// Whether the rendered document can be fetched yet.
///
/// Measured 2026-07-31: the carrier answered `Progress: 0.99` with
/// `IsComplete: false` while the PDF was already served at 200 with 1.5 MB of
/// `application/pdf`. A job that waits for `IsComplete` waits forever, so this
/// treats a nearly-finished render as ready — and stops immediately on the
/// carrier's own failure flags rather than polling a dead render.
export function reportReadiness(progress: ReportProgress): 'READY' | 'WAIT' | 'FAILED' {
  if (!progress) return 'WAIT'
  if (progress.HasException || progress.IsAborting) return 'FAILED'
  if (progress.IsComplete) return 'READY'
  return typeof progress.Progress === 'number' && progress.Progress >= 0.99 ? 'READY' : 'WAIT'
}

/// What the agent sees when the PDF opens. The insured's name is the only thing
/// that makes one illustration distinguishable from another in a tab strip.
export function illustrationDocumentFilename(
  insuredName: string | null,
  createdAt: Date,
): string {
  const who = (insuredName ?? 'ilustracao')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const when = createdAt.toISOString().slice(0, 10)
  return `${who || 'ilustracao'}-${when}.pdf`
}

/// A response is only a document if it actually is one. The carrier serves an
/// HTML error page with status 200 when the session lapses mid-render, and
/// storing that as a PDF would surface as a corrupt file much later.
export function isPdfPayload(bytes: Uint8Array): boolean {
  return (
    bytes.length > 1024 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  )
}
