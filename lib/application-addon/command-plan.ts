import type { IssueConnectorCommandInput } from '@/lib/national-life/connector-command-service'

type ApplicationCommandRecord = {
  id: string
  automationState: string
  dossierHash: string | null
  reviewedAt: Date | null
  externalId: string | null
  carrierReceipt: unknown
}

type CommandPlanContext = {
  agentId: string
  entitled: boolean
  deviceId?: string
  expiresAt: Date
}

function requireEntitlement(context: CommandPlanContext): void {
  if (!context.entitled) throw new Error('K_BOT_APPLICATION_ADDON_REQUIRED')
}

function commandContext(context: CommandPlanContext) {
  return {
    agentId: context.agentId,
    ...(context.deviceId ? { deviceId: context.deviceId } : {}),
    expiresAt: context.expiresAt,
  }
}

export function planApplicationDraftCommand(
  application: ApplicationCommandRecord,
  context: CommandPlanContext,
): IssueConnectorCommandInput {
  requireEntitlement(context)
  if (!application.reviewedAt || !application.dossierHash) {
    throw new Error('APPLICATION_NOT_REVIEWED')
  }
  if (application.automationState !== 'READY_TO_PREPARE') {
    throw new Error('APPLICATION_NOT_READY')
  }
  const payloadHash = application.dossierHash
  return {
    ...commandContext(context),
    capability: 'PREPARE_APPLICATION_DRAFT',
    target: { kind: 'APPLICATION', id: application.id },
    params: { applicationId: application.id, payloadHash },
    idempotencyKey: `igo:draft:${application.id}:${payloadHash}`,
  }
}

function readBackHash(receipt: unknown): string | null {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null
  const hash = (receipt as Record<string, unknown>).draftReadBackHash
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash) ? hash : null
}

export function planApplicationSubmitCommand(
  application: ApplicationCommandRecord,
  context: CommandPlanContext,
): IssueConnectorCommandInput {
  requireEntitlement(context)
  if (application.automationState !== 'READY_TO_SUBMIT' || !application.externalId) {
    throw new Error('APPLICATION_NOT_READY_TO_SUBMIT')
  }
  const payloadHash = readBackHash(application.carrierReceipt)
  if (!payloadHash) throw new Error('APPLICATION_CARRIER_READBACK_REQUIRED')
  return {
    ...commandContext(context),
    capability: 'SUBMIT_APPLICATION',
    target: {
      kind: 'APPLICATION',
      id: application.id,
      carrierExternalId: application.externalId,
    },
    params: { applicationId: application.id, payloadHash },
    idempotencyKey: `igo:submit:${application.id}:${payloadHash}`,
  }
}
