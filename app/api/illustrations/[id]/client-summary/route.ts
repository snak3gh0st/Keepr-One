import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { buildClientSummary } from '@/lib/national-life/client-summary'
import { clientSummaryFilename, renderClientSummaryPdf } from '@/lib/national-life/client-summary-pdf'

/// Serves the one-page summary the agent may send to the insured.
///
/// Read access is the agent's, exactly as on the official PDF route beside this
/// one: the carrier document and this summary are two views of the same numbers,
/// and it would be incoherent for one to be reachable by someone the other is
/// not. The insured receives this as a file the agent chose to send, not as a
/// link back into Keepr One — which is also why nothing here is cached and no
/// bytes are stored. Regenerating from the verified payload means the summary
/// can never drift from the illustration it claims to summarise.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireRole('ADMIN', 'AGENT')
  } catch {
    return new NextResponse('Not authenticated', { status: 401 })
  }

  const { id } = await params
  const illustration = await prisma.illustration.findUnique({
    where: { id },
    select: {
      agentId: true,
      insuredName: true,
      productName: true,
      documentFetchedAt: true,
      documentMimeType: true,
      rawPayload: true,
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

  // No summary exists for an illustration National Life has not confirmed. This
  // is the same gate the agent's screen applies before it offers the button, so
  // reaching it here means a stale page or a hand-typed URL — neither of which
  // may produce a client-facing document out of unverified numbers.
  const summary = buildClientSummary(illustration)
  if (!summary) return new NextResponse('Not found', { status: 404 })

  const bytes = await renderClientSummaryPdf(summary)
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      // `attachment`, unlike the carrier PDF beside it: this one exists to be
      // saved and forwarded, so the browser should hand over a file rather than
      // open a tab the agent then has to export from.
      'Content-Disposition': `attachment; filename="${clientSummaryFilename(summary)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
