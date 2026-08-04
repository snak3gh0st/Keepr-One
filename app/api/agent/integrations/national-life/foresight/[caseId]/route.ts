import { NextResponse } from 'next/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
import { enqueueForesightPdf, enqueueForesightRead } from '@/lib/national-life/job-service'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  if (!isNationalLifeConfigured()) {
    return NextResponse.json({ ok: false, message: 'Integração indisponível.' }, { status: 503 })
  }

  try {
    const agent = await getCurrentAgent()
    const { caseId } = await context.params
    const body = await request.json().catch(() => null) as { action?: unknown } | null
    const action = body?.action
    if ((action !== 'DETAIL' && action !== 'PDF') || !caseId || caseId.length > 128) {
      return NextResponse.json({ ok: false, message: 'Ação inválida.' }, { status: 400 })
    }

    const deploymentScope = getNationalLifeEnv().sessionScopeId
    const snapshot = await prisma.nationalLifeForesightCaseSnapshot.findFirst({
      where: {
        id: caseId,
        agentId: agent.id,
        deploymentScope,
        provider: NATIONAL_LIFE_PROVIDER,
      },
      select: { id: true, externalKey: true },
    })
    if (!snapshot) return NextResponse.json({ ok: false, message: 'Caso não encontrado.' }, { status: 404 })

    const result = action === 'DETAIL'
      ? await enqueueForesightRead({
          agentId: agent.id,
          deploymentScope,
          mode: 'DETAIL',
          targetCaseId: snapshot.id,
        })
      : await enqueueForesightPdf({
          agentId: agent.id,
          deploymentScope,
          caseSnapshotId: snapshot.id,
          caseKey: snapshot.externalKey,
        })

    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ ok: false, message: 'Não foi possível agendar essa leitura.' }, { status: 404 })
  }
}
