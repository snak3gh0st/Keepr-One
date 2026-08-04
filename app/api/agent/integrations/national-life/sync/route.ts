import { NextResponse } from 'next/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { getNationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'

const NO_STORE = { 'Cache-Control': 'no-store' }

function publicSyncStatus(status: Awaited<ReturnType<typeof getNationalLifeSyncStatus>>) {
  if (!status) return null
  return Object.fromEntries(
    Object.entries(status).filter(([key]) => key !== 'safeErrorCode'),
  )
}

export async function GET() {
  const localEnabled = getNationalLifeLocalConnectorConfig().enabled
  const remoteConfigured = isNationalLifeConfigured()
  if (!localEnabled && !remoteConfigured) {
    return NextResponse.json({ run: null }, { headers: NO_STORE })
  }

  try {
    const agent = await getCurrentAgent()
    const localStatus = localEnabled
      ? await getNationalLifeSyncStatus(agent.id, LOCAL_CONNECTOR_DEPLOYMENT_SCOPE)
      : null
    const status =
      localStatus ??
      (remoteConfigured
        ? await getNationalLifeSyncStatus(agent.id, getNationalLifeEnv().sessionScopeId)
        : null)
    return NextResponse.json({ run: publicSyncStatus(status) }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ run: null }, { headers: NO_STORE })
  }
}
