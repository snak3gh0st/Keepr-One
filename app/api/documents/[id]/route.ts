import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { canAccessPolicy } from '@/lib/policy-access'
import { readStoredFile } from '@/lib/storage'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireRole('ADMIN', 'AGENT', 'CLIENT')
  } catch {
    return new NextResponse('Not authenticated', { status: 401 })
  }

  const { id } = await params
  const document = await prisma.policyDocument.findUnique({
    where: { id },
    include: { policy: true },
  })
  if (!document) return new NextResponse('Not found', { status: 404 })

  const role = session.user.role as unknown as 'ADMIN' | 'AGENT' | 'CLIENT'
  let allowed = false

  if (role === 'ADMIN') {
    allowed = true
  } else if (role === 'AGENT') {
    try {
      const agent = await getCurrentAgent()
      const scopeIds = await getAgentScopeIds(agent.id)
      allowed = canAccessPolicy({ role: 'AGENT', agentScopeIds: scopeIds }, document.policy)
    } catch {
      return new NextResponse('Forbidden', { status: 403 })
    }
  } else {
    const client = await prisma.client.findUnique({ where: { userId: session.user.id } })
    if (client) {
      allowed = canAccessPolicy({ role: 'CLIENT', clientId: client.id }, document.policy)
    }
  }

  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  const uploadsDir = process.env.UPLOADS_DIR ?? './uploads'
  const buffer = await readStoredFile(uploadsDir, document.storedPath)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${document.filename}"`,
    },
  })
}
