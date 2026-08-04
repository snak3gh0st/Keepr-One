import { getCurrentAgent } from '@/lib/agent-context'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
import { prisma } from '@/lib/prisma'

export async function GET(
  _request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  if (!isNationalLifeConfigured()) return new Response(null, { status: 404 })
  try {
    const agent = await getCurrentAgent()
    const { caseId } = await context.params
    const document = await prisma.nationalLifeForesightDocument.findFirst({
      where: {
        caseSnapshotId: caseId,
        agentId: agent.id,
        deploymentScope: getNationalLifeEnv().sessionScopeId,
        provider: NATIONAL_LIFE_PROVIDER,
        reportKey: 'foresight-report',
      },
      select: { bytes: true, mimeType: true, filename: true },
    })
    if (!document) return new Response(null, { status: 404 })
    return new Response(document.bytes, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': document.mimeType,
        'Content-Disposition': `inline; filename="${document.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
