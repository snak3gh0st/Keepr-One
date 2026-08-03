import { NextResponse } from 'next/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
import { getNationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'

export async function GET() {
  if (!isNationalLifeConfigured()) {
    return NextResponse.json({ run: null })
  }

  try {
    const agent = await getCurrentAgent()
    const status = await getNationalLifeSyncStatus(
      agent.id,
      getNationalLifeEnv().sessionScopeId,
    )
    return NextResponse.json({ run: status })
  } catch {
    return NextResponse.json({ run: null })
  }
}
