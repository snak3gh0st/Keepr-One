import { NextResponse } from 'next/server'
import { getCurrentAgent } from '@/lib/agent-context'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { getNationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import {
  NATIONAL_LIFE_SYNC_ENGINE,
  NATIONAL_LIFE_SYNC_PIPELINE,
} from '@/lib/national-life/sync-engine'

const NO_STORE = { 'Cache-Control': 'no-store' }

function publicSyncStatus(status: Awaited<ReturnType<typeof getNationalLifeSyncStatus>>) {
  if (!status) return null
  return Object.fromEntries(
    Object.entries(status).filter(([key]) => key !== 'safeErrorCode'),
  )
}

export async function GET() {
  const localEnabled = getNationalLifeLocalConnectorConfig().enabled
  if (!localEnabled) {
    return NextResponse.json(
      { engine: NATIONAL_LIFE_SYNC_ENGINE, pipeline: NATIONAL_LIFE_SYNC_PIPELINE, run: null },
      { headers: NO_STORE },
    )
  }

  try {
    const agent = await getCurrentAgent()
    const status = await getNationalLifeSyncStatus(agent.id, LOCAL_CONNECTOR_DEPLOYMENT_SCOPE)
    return NextResponse.json(
      {
        engine: NATIONAL_LIFE_SYNC_ENGINE,
        pipeline: NATIONAL_LIFE_SYNC_PIPELINE,
        run: publicSyncStatus(status),
      },
      { headers: NO_STORE },
    )
  } catch {
    return NextResponse.json(
      { engine: NATIONAL_LIFE_SYNC_ENGINE, pipeline: NATIONAL_LIFE_SYNC_PIPELINE, run: null },
      { headers: NO_STORE },
    )
  }
}
