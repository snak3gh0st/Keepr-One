import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { buildClientSummary } from '@/lib/national-life/client-summary'
import { extractForesightTermLedger } from '@/lib/national-life/foresight-term-ledger'
import {
  clientSummaryFilename,
  renderClientSummaryPdf,
  type ClientSummaryVariant,
} from '@/lib/national-life/client-summary-pdf'
import type { ClientSummaryLanguage } from '@/lib/national-life/client-summary-copy'

/// Serves the document the agent may send to the insured, in the requested
/// shape and language.
///
/// Read access is the agent's, exactly as on the official PDF route beside this
/// one: the carrier document and this summary are two views of the same numbers,
/// and it would be incoherent for one to be reachable by someone the other is
/// not. The insured receives this as a file the agent chose to send, not as a
/// link back into Keepr One — which is also why nothing here is cached and no
/// bytes are stored. Regenerating from the verified payload means the document
/// can never drift from the illustration it claims to summarise.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireRole('ADMIN', 'AGENT')
  } catch {
    return new NextResponse('Not authenticated', { status: 401 })
  }

  const { id } = await params
  const query = new URL(request.url).searchParams
  // Unknown values fall back rather than failing: a stale link or a typed URL
  // should hand the agent the safe, shorter document, not an error page in
  // front of a client.
  const variant: ClientSummaryVariant = query.get('variant') === 'full' ? 'FULL' : 'QUICK'
  const language: ClientSummaryLanguage = query.get('lang') === 'pt' ? 'PT' : 'EN'

  const illustration = await prisma.illustration.findUnique({
    where: { id },
    select: {
      agentId: true,
      insuredName: true,
      productName: true,
      documentFetchedAt: true,
      documentMimeType: true,
      rawPayload: true,
      agent: { select: { user: { select: { name: true } } } },
    },
  })
  if (!illustration) return new NextResponse('Not found', { status: 404 })

  let allowed = session.user.role === 'ADMIN'
  if (session.user.role === 'AGENT') {
    try {
      const agent = await getCurrentAgent()
      const scopeIds = await getAgentScopeIds(agent.id)
      allowed = scopeIds.includes(illustration.agentId)
    } catch {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  // Term's year-by-year premium comes from the carrier's own Ledger pages, and
  // the only copy of them Keepr One holds is the stored PDF — so it is read
  // here, on the way to the document that needs it, rather than kept in a
  // column that could drift from the file it was derived from.
  //
  // The bytes are fetched in a query of their own, and only for Term: a
  // FlexLife illustration runs to well over a megabyte and has no ledger worth
  // reading, so loading it would be a megabyte moved to be thrown away. A PDF
  // that will not parse costs the schedule, not the document — the summary
  // falls back to the shape it had before the ledger existed.
  const termLedger = await readTermLedger(id, illustration.rawPayload)

  // The advisor named on the document is the agent who owns the illustration,
  // not whoever is downloading it: an admin pulling a copy must not put their
  // own name on a client's plan.
  const summary = buildClientSummary({
    ...illustration,
    advisorName: illustration.agent?.user?.name ?? null,
    termLedger,
  })
  // No document exists for an illustration National Life has not confirmed.
  // This is the same gate the agent's screen applies before it offers the
  // download, so reaching it here means a stale page or a hand-typed URL —
  // neither of which may produce a client-facing document out of unverified
  // numbers.
  if (!summary) return new NextResponse('Not found', { status: 404 })

  const bytes = await renderClientSummaryPdf(summary, { variant, language })
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      // `attachment`, unlike the carrier PDF beside it: this one exists to be
      // saved and forwarded, so the browser should hand over a file rather than
      // open a tab the agent then has to export from.
      'Content-Disposition': `attachment; filename="${clientSummaryFilename(summary, variant)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

function isTermIllustration(rawPayload: unknown): boolean {
  return typeof rawPayload === 'object' && rawPayload !== null &&
    'foresightTermResult' in rawPayload
}

async function readTermLedger(id: string, rawPayload: unknown) {
  if (!isTermIllustration(rawPayload)) return null
  const stored = await prisma.illustration.findUnique({
    where: { id },
    select: { documentBytes: true },
  })
  if (!stored?.documentBytes) return null
  try {
    return await extractForesightTermLedger(new Uint8Array(stored.documentBytes))
  } catch {
    return null
  }
}
