import { getCurrentAgent } from '@/lib/agent-context'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'
import {
  foresightDocumentsDir,
  readForesightDocument,
} from '@/lib/national-life/foresight-document-storage'
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
      select: { bytes: true, storageKey: true, mimeType: true, filename: true },
    })
    if (!document) return new Response(null, { status: 404 })

    // Os dois estados convivem de propósito. Escritas novas nascem em disco;
    // linhas gravadas antes desta mudança só saem do banco quando o backfill as
    // move, e até lá são servidas daqui. Quando `bytes` for derrubado, este
    // ramo morre junto com a coluna.
    const uploadsDir = foresightDocumentsDir()
    const body =
      document.storageKey && uploadsDir
        ? await readForesightDocument(uploadsDir, document.storageKey)
        : document.bytes
    if (!body) return new Response(null, { status: 404 })

    return new Response(new Uint8Array(body), {
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
