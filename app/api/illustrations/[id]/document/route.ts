import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineIds } from '@/lib/hierarchy'
import { illustrationDocumentFilename } from '@/lib/national-life/foresight-report'

/// Serves the illustration PDF the carrier rendered.
///
/// Deliberately not open to CLIENT, unlike a policy document. The carrier's own
/// condition on these numbers is that they may back a verbal quote and must not
/// be shown to the insured — so the document is for the agent who asked for it,
/// and the route is the place that has to enforce it.
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
      createdAt: true,
      documentBytes: true,
      documentMimeType: true,
    },
  })
  if (!illustration?.documentBytes) return new NextResponse('Not found', { status: 404 })

  let allowed = session.user.role === 'ADMIN'
  if (session.user.role === 'AGENT') {
    try {
      const agent = await getCurrentAgent()
      const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
      allowed = [agent.id, ...getDownlineIds(allAgents, agent.id)].includes(illustration.agentId)
    } catch {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  return new NextResponse(new Uint8Array(illustration.documentBytes), {
    headers: {
      'Content-Type': illustration.documentMimeType ?? 'application/pdf',
      // `inline` so the agent reads it in the browser during a call rather than
      // hunting through a downloads folder.
      'Content-Disposition': `inline; filename="${illustrationDocumentFilename(
        illustration.insuredName,
        illustration.createdAt,
      )}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
