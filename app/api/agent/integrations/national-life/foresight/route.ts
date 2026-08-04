import { NextResponse } from 'next/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
import { foresightRunStore } from '@/lib/national-life/foresight-run-service'
import { prisma } from '@/lib/prisma'

export async function GET() {
  if (!isNationalLifeConfigured()) return NextResponse.json({ run: null, cases: [] })

  try {
    const agent = await getCurrentAgent()
    const deploymentScope = getNationalLifeEnv().sessionScopeId
    const [run, cases] = await Promise.all([
      foresightRunStore.getStatus(agent.id, deploymentScope),
      prisma.nationalLifeForesightCaseSnapshot.findMany({
        where: { agentId: agent.id, deploymentScope, provider: NATIONAL_LIFE_PROVIDER },
        select: {
          id: true,
          displayName: true,
          caseKind: true,
          product: true,
          status: true,
          state: true,
          observedAt: true,
          _count: { select: { services: true } },
        },
        orderBy: [{ observedAt: 'desc' }, { displayName: 'asc' }],
      }),
    ])

    return NextResponse.json({
      run,
      cases: cases.map(({ _count, ...item }) => ({ ...item, serviceCount: _count.services })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ run: null, cases: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
