import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import {
  NATIONAL_LIFE_LOGIN_REQUIRED_CODES,
  NATIONAL_LIFE_PROVIDER,
} from '@/lib/national-life/constants'
import { carrierSyncState } from '@/lib/national-life/carrier-sync-state'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { getNationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import { sanitizeNationalLifeSyncStatusForAgent } from '@/lib/national-life/plan-access'

type IllustrationActivity = {
  id: string
  state: 'WORKING' | 'NEEDS_YOU' | 'READY' | 'FAILED'
  updatedAt: Date
}

function illustrationTargetId(target: unknown): string | null {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null
  const candidate = target as Record<string, unknown>
  return candidate.kind === 'ILLUSTRATION' && typeof candidate.id === 'string'
    ? candidate.id
    : null
}

async function illustrationActivity(agentId: string, command: {
  state: string
  target: unknown
  updatedAt: Date
} | null): Promise<IllustrationActivity | null> {
  if (!command) return null
  const id = illustrationTargetId(command.target)
  if (!id) return null
  if (command.state === 'AUTH_REQUIRED') return { id, state: 'NEEDS_YOU', updatedAt: command.updatedAt }
  if (['QUEUED', 'RUNNING', 'WAITING_FOR_CONFIRMATION', 'PAUSED'].includes(command.state)) {
    return { id, state: 'WORKING', updatedAt: command.updatedAt }
  }
  if (command.state === 'COMPLETED') {
    const illustration = await prisma.illustration.findFirst({
      where: { id, agentId, documentFetchedAt: { not: null } },
      select: { documentFetchedAt: true },
    })
    return { id, state: illustration ? 'READY' : 'FAILED', updatedAt: command.updatedAt }
  }
  if (command.state === 'FAILED' || command.state === 'CANCELLED') {
    return { id, state: 'FAILED', updatedAt: command.updatedAt }
  }
  return null
}

/// A compact, user-owned activity snapshot for the global shell. The client
/// only polls this route while an operation is active, so idle accounts remain
/// quiet while a running sync and illustration can be represented together.
export async function GET() {
  const localConnector = getNationalLifeLocalConnectorConfig()
  const connector = localConnector.enabled
    ? { enabled: true, extensionTarget: localConnector.extensionTarget }
    : { enabled: false, extensionTarget: null }

  if (!localConnector.enabled) {
    // No integration, no badge. Not every agent connects one.
    return NextResponse.json({ state: null, connector })
  }
  try {
    const agent = await getCurrentAgent()
    const [working, blocked, rawSync, latestIllustrationCommand] = await Promise.all([
      prisma.browserAutomationJob.count({
        where: {
          agentId: agent.id,
          provider: NATIONAL_LIFE_PROVIDER,
          state: { in: ['QUEUED', 'RUNNING', 'RETRYABLE'] },
        },
      }),
      prisma.browserAutomationJob.count({
        where: {
          agentId: agent.id,
          provider: NATIONAL_LIFE_PROVIDER,
          state: 'ACTION_REQUIRED',
          // Keep this filter identical to the transaction drain: every code
          // counted here is one a fresh carrier login actually revives.
          safeErrorCode: { in: [...NATIONAL_LIFE_LOGIN_REQUIRED_CODES] },
        },
      }),
      getNationalLifeSyncStatus(agent.id, LOCAL_CONNECTOR_DEPLOYMENT_SCOPE),
      prisma.nationalLifeConnectorCommand.findFirst({
        where: { agentId: agent.id, capability: 'GENERATE_ILLUSTRATION' },
        orderBy: { createdAt: 'desc' },
        select: { state: true, target: true, updatedAt: true },
      }),
    ])
    const sync = await sanitizeNationalLifeSyncStatusForAgent(agent.id, rawSync)
    const illustration = await illustrationActivity(agent.id, latestIllustrationCommand)
    return NextResponse.json({
      state: carrierSyncState({ working, blocked }),
      connector,
      ...(sync ? { sync } : {}),
      ...(illustration ? { illustration } : {}),
    })
  } catch {
    // A badge that does not know what it is saying is worse than no badge —
    // that is how the illustration reachability flag lied for hours.
    return NextResponse.json({ state: null, connector })
  }
}
