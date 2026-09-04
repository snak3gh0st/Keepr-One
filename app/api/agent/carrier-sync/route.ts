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

import { featureEnabled } from '@/lib/kbot-followup/domain'

const responseHeaders = { 'Cache-Control': 'private, no-store' }

type IllustrationActivity = {
  id: string
  state: 'WORKING' | 'NEEDS_YOU' | 'NEEDS_KBOT' | 'READY' | 'FAILED'
  updatedAt: Date
}

type ApplicationActivity = {
  id: string
  caseId: string
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
  deviceId: string | null
  target: unknown
  expiresAt: Date
  updatedAt: Date
} | null): Promise<IllustrationActivity | null> {
  if (!command) return null
  const id = illustrationTargetId(command.target)
  if (!id) return null
  if (
    command.expiresAt <= new Date() &&
    ['QUEUED', 'RUNNING', 'AUTH_REQUIRED', 'WAITING_FOR_CONFIRMATION', 'PAUSED'].includes(command.state)
  ) return null
  if (command.state === 'AUTH_REQUIRED') return { id, state: 'NEEDS_YOU', updatedAt: command.updatedAt }
  if (command.state === 'QUEUED' && command.deviceId === null) {
    return { id, state: 'NEEDS_KBOT', updatedAt: command.updatedAt }
  }
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

async function applicationActivity(agentId: string, command: {
  state: string
  target: unknown
  expiresAt: Date
  updatedAt: Date
} | null): Promise<ApplicationActivity | null> {
  if (!command) return null
  const target = command.target && typeof command.target === 'object' && !Array.isArray(command.target)
    ? command.target as Record<string, unknown>
    : null
  const id = target?.kind === 'APPLICATION' && typeof target.id === 'string' ? target.id : null
  if (!id) return null
  if (command.expiresAt <= new Date() &&
    ['QUEUED', 'RUNNING', 'AUTH_REQUIRED', 'WAITING_FOR_CONFIRMATION', 'PAUSED'].includes(command.state)) {
    return null
  }
  const application = await prisma.application.findFirst({
    where: { id, insuranceCase: { assignedAgentId: agentId } },
    select: { caseId: true, automationState: true },
  })
  if (!application) return null
  const base = { id, caseId: application.caseId, updatedAt: command.updatedAt }
  if (command.state === 'AUTH_REQUIRED') return { ...base, state: 'NEEDS_YOU' }
  if (['QUEUED', 'RUNNING', 'WAITING_FOR_CONFIRMATION', 'PAUSED'].includes(command.state)) {
    return { ...base, state: 'WORKING' }
  }
  if (command.state === 'COMPLETED') {
    return {
      ...base,
      state: ['DRAFT_READY', 'NEEDS_INFORMATION', 'READY_TO_SUBMIT', 'SUBMITTED']
        .includes(application.automationState) ? 'READY' : 'FAILED',
    }
  }
  if (command.state === 'FAILED' || command.state === 'CANCELLED') {
    return { ...base, state: 'FAILED' }
  }
  return null
}

/// A compact, user-owned activity snapshot for the global shell and activity
/// center. Clients refresh only while visible, with faster polling during work.
export async function GET() {
  const localConnector = getNationalLifeLocalConnectorConfig()
  const connector = localConnector.enabled
    ? { enabled: true, extensionTarget: localConnector.extensionTarget }
    : { enabled: false, extensionTarget: null }

  if (!localConnector.enabled && !featureEnabled()) {
    // No integration, no badge. Not every agent connects one.
    return NextResponse.json({ state: null, connector }, { headers: responseHeaders })
  }
  try {
    const agent = await getCurrentAgent()
    const followup = featureEnabled() ? await (async () => {
      const [working, attention] = await Promise.all([
        prisma.kBotFollowupJob.count({ where: { agentId: agent.id, status: { in: ['PENDING', 'PREPARING', 'DISPATCHING', 'ACCEPTED', 'CANCEL_REQUESTED'] } } }),
        prisma.kBotFollowupJob.count({ where: { agentId: agent.id, OR: [
          { status: 'UNKNOWN' }, { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - 86_400_000) } },
        ] } }),
      ])
      return { working, attention }
    })() : null
    if (!localConnector.enabled) return NextResponse.json({ state: null, connector, followup }, { headers: responseHeaders })
    const [working, blocked, rawSync, latestIllustrationCommand, latestApplicationCommand, credential] = await Promise.all([
      prisma.browserAutomationJob.count({
        where: {
          agentId: agent.id,
          provider: NATIONAL_LIFE_PROVIDER,
          // Rapid Solve was retired from the user flow. Historical jobs from
          // that executor must not keep asking a connected K-Bot to reconnect.
          operation: { not: 'GET_RAPID_SOLVE_QUOTE' },
          state: { in: ['QUEUED', 'RUNNING', 'RETRYABLE'] },
        },
      }),
      prisma.browserAutomationJob.count({
        where: {
          agentId: agent.id,
          provider: NATIONAL_LIFE_PROVIDER,
          operation: { not: 'GET_RAPID_SOLVE_QUOTE' },
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
        select: { state: true, deviceId: true, target: true, expiresAt: true, updatedAt: true },
      }),
      prisma.nationalLifeConnectorCommand.findFirst({
        where: {
          agentId: agent.id,
          capability: { in: ['PREPARE_APPLICATION_DRAFT', 'SUBMIT_APPLICATION'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { state: true, target: true, expiresAt: true, updatedAt: true },
      }),
      prisma.agentIntegrationCredential.findUnique({
        where: { agentId_provider: { agentId: agent.id, provider: NATIONAL_LIFE_PROVIDER } },
        select: { autoLoginEnabled: true },
      }),
    ])
    const sync = await sanitizeNationalLifeSyncStatusForAgent(agent.id, rawSync)
    const illustration = await illustrationActivity(agent.id, latestIllustrationCommand)
    const application = await applicationActivity(agent.id, latestApplicationCommand)
    return NextResponse.json({
      state: carrierSyncState({ working, blocked }),
      ...(followup ? { followup } : {}),
      connector: credential?.autoLoginEnabled ? { ...connector, autoLoginEnabled: true } : connector,
      ...(sync ? { sync } : {}),
      ...(illustration ? { illustration } : {}),
      ...(application ? { application } : {}),
    }, { headers: responseHeaders })
  } catch {
    // A badge that does not know what it is saying is worse than no badge —
    // that is how the illustration reachability flag lied for hours.
    return NextResponse.json({ state: null, connector }, { status: 503, headers: responseHeaders })
  }
}
