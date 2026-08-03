import { NextResponse } from 'next/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
import { getNationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'

function publicSyncStatus(status: Awaited<ReturnType<typeof getNationalLifeSyncStatus>>) {
  if (!status) return null
  return Object.fromEntries(
    Object.entries(status).filter(([key]) => key !== 'safeErrorCode'),
  )
}

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
    return NextResponse.json({ run: publicSyncStatus(status) })
  } catch {
    return NextResponse.json({ run: null })
  }
}
