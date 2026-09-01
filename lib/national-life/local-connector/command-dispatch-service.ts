import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  commandMayExecute,
  ConnectorCommandError,
  recordConnectorCommandEvent,
  type ConnectorCommandRepository,
} from '../connector-command-service'
import {
  parseConnectorCommand,
  parseConnectorCommandEvent,
  type ConnectorCommand,
} from '../connector-command-contract'
import { parseNationalLifePolicyDetail } from '../policy-detail'
import {
  persistNationalLifePolicyDetail,
  type PolicyDetailRepository,
} from '../policy-detail-service'
import {
  buildForesightIllustrationSnapshot,
  foresightIllustrationInputHash,
  parseForesightIllustrationReceipt,
  parseForesightSolvedIllustrationReceipt,
  type ForesightIllustrationSnapshot,
  type ForesightSolvedIllustrationReceipt,
} from '../foresight-illustration-contract'
import {
  buildForesightTermIllustrationSnapshot,
  foresightTermIllustrationInputHash,
  parseForesightTermIllustrationReceipt,
  type ForesightTermIllustrationReceipt,
  type ForesightTermIllustrationSnapshotV1,
} from '../foresight-term-contract'
import {
  buildFlexLifeQuoteSnapshot,
  flexLifeQuoteInputHash,
  type FlexLifeQuoteSnapshotV1,
} from '../flexlife-quote-contract'
import {
  parseApplicationDossierV2,
  sha256ApplicationDossierV2,
  type ApplicationDossierV2,
} from '@/lib/application-addon/dossier-contract'
import {
  parseIgoApplicationDraftReceipt,
  type IgoApplicationDraftReceipt,
} from '@/lib/application-addon/igo-receipt'

export type LocalConnectorCommandCandidate = {
  id: string
  agentId: string
  deviceId: string | null
  protocolVersion: number
  runId: string
  capability: string
  target: Prisma.JsonValue | null
  params: Prisma.JsonValue
  payloadHash: string
  idempotencyKey: string
  requiresConfirmation: boolean
  confirmationState: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  state: string
  expiresAt: Date
  createdAt: Date
  events: Array<{ sequence: number; type?: string }>
}

export type LocalConnectorCommandDispatchRepository = ConnectorCommandRepository & {
  claimNext(input: {
    agentId: string
    deviceId: string
    now: Date
    commandId?: string
  }): Promise<LocalConnectorCommandCandidate | null>
  findDeviceOwned(input: {
    agentId: string
    deviceId: string
    commandId: string
  }): Promise<LocalConnectorCommandCandidate | null>
}

export type ForesightIllustrationInputRepository = {
  findOwnedIllustration(input: {
    agentId: string
    illustrationId: string
  }): Promise<{
    id: string
    caseId: string | null
    createdAt: Date
    productName: string | null
    rawPayload: unknown
  } | null>
}

export type ApplicationDraftInputRepository = {
  findOwnedApplication(input: {
    agentId: string
    applicationId: string
  }): Promise<{
    id: string
    automationState: string
    dossier: unknown
    dossierHash: string | null
    reviewedAt: Date | null
  } | null>
}

export type ApplicationDraftSnapshotV2 = {
  schemaVersion: 2
  applicationId: string
  payloadHash: string
  dossier: ApplicationDossierV2
}

export type ForesightArtifactRepository = {
  findOwnedArtifact(input: { agentId: string; illustrationId: string }): Promise<{
    provider: string | null
    externalId: string | null
    productName: string | null
    documentBytes: Uint8Array | null
    documentMimeType: string | null
  } | null>
  persistSolvedResult?: (input: {
    agentId: string
    illustrationId: string
    solveBasis: 'DEATH_BENEFIT' | 'PREMIUM'
    faceAmount: number
    monthlyPremium: number
    annualPremium: number
  }) => Promise<void>
  persistTermResult?: (input: {
    agentId: string
    illustrationId: string
    monthlyPremium: number
    annualPremium: number
    requestedTermDuration?: '10-G' | '15-G' | '20-G' | '30-G' | 'ART'
    confirmedTermDuration?: '10-G' | '15-G' | '20-G' | '30-G' | 'ART'
  }) => Promise<void>
}

export type FlexLifeQuoteResultRepository = {
  persistOwnedQuoteResult(input: {
    agentId: string
    illustrationId: string
    inputHash: string
    response: Record<string, unknown>
  }): Promise<void>
}

export type ApplicationDraftReceiptRepository = {
  persistOwnedDraftReceipt(input: {
    agentId: string
    applicationId: string
    receipt: IgoApplicationDraftReceipt
  }): Promise<void>
  persistOwnedDraftFailure?(input: {
    agentId: string
    applicationId: string
    safeErrorCode: string
  }): Promise<void>
}

function isForesightSolvedIllustrationReceipt(
  receipt: unknown,
): receipt is ForesightSolvedIllustrationReceipt {
  return parseForesightSolvedIllustrationReceipt(receipt) !== null
}

function isForesightTermIllustrationReceipt(
  receipt: unknown,
): receipt is ForesightTermIllustrationReceipt {
  return parseForesightTermIllustrationReceipt(receipt) !== null
}

function toPublicCommand(candidate: LocalConnectorCommandCandidate): ConnectorCommand {
  const command = parseConnectorCommand({
    protocolVersion: candidate.protocolVersion,
    commandId: candidate.id,
    runId: candidate.runId,
    capability: candidate.capability,
    target: candidate.target,
    params: candidate.params,
    idempotencyKey: candidate.idempotencyKey,
    issuedAt: candidate.createdAt.toISOString(),
    expiresAt: candidate.expiresAt.toISOString(),
    requiresConfirmation: candidate.requiresConfirmation,
  })
  if (!command) throw new ConnectorCommandError('COMMAND_INVALID')
  return command
}

export async function claimNextConnectorCommand(
  repository: LocalConnectorCommandDispatchRepository,
  input: { agentId: string; deviceId: string; commandId?: string; now?: Date },
): Promise<{
  command: ConnectorCommand
  state: 'QUEUED' | 'RUNNING' | 'AUTH_REQUIRED'
  nextEventSequence: number
  lastEventType: string | null
} | null> {
  const now = input.now ?? new Date()
  const candidate = await repository.claimNext({
    agentId: input.agentId,
    deviceId: input.deviceId,
    now,
    ...(input.commandId ? { commandId: input.commandId } : {}),
  })
  if (!candidate) return null

  // Defense in depth: never trust repository scoping as the authorization
  // boundary for a browser command.
  if (candidate.agentId !== input.agentId || candidate.deviceId !== input.deviceId) {
    throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  }
  if (candidate.expiresAt <= now) throw new ConnectorCommandError('COMMAND_EXPIRED')
  if (!['QUEUED', 'RUNNING', 'AUTH_REQUIRED'].includes(candidate.state)) {
    throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  }

  const command = toPublicCommand(candidate)
  if (!commandMayExecute(command, candidate.confirmationState)) {
    throw new ConnectorCommandError('CONFIRMATION_REQUIRED')
  }
  const state = candidate.state as 'QUEUED' | 'RUNNING' | 'AUTH_REQUIRED'
  return {
    command,
    state,
    nextEventSequence: candidate.events.length,
    lastEventType: candidate.events.at(-1)?.type ?? null,
  }
}

export async function readDeviceConnectorCommandInput(
  repository: LocalConnectorCommandDispatchRepository,
  illustrationRepository: ForesightIllustrationInputRepository,
  applicationRepository: Partial<ApplicationDraftInputRepository>,
  input: { agentId: string; deviceId: string; commandId: string; now?: Date },
): Promise<{
  inputHash: string
  snapshot: ForesightIllustrationSnapshot | ForesightTermIllustrationSnapshotV1 |
    FlexLifeQuoteSnapshotV1 | ApplicationDraftSnapshotV2
}> {
  const command = await repository.findDeviceOwned(input)
  const now = input.now ?? new Date()
  if (!command || command.agentId !== input.agentId || command.deviceId !== input.deviceId) {
    throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  }
  if (command.expiresAt <= now) throw new ConnectorCommandError('COMMAND_EXPIRED')
  if (command.confirmationState !== 'APPROVED' ||
    !['QUEUED', 'RUNNING', 'AUTH_REQUIRED'].includes(command.state)) {
    throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  }
  const publicCommand = toPublicCommand(command)
  if (command.capability === 'PREPARE_APPLICATION_DRAFT') {
    if (
      publicCommand.target?.kind !== 'APPLICATION' ||
      !('applicationId' in publicCommand.params) ||
      !('payloadHash' in publicCommand.params) ||
      publicCommand.params.applicationId !== publicCommand.target.id ||
      !applicationRepository.findOwnedApplication
    ) throw new ConnectorCommandError('COMMAND_INVALID')
    const application = await applicationRepository.findOwnedApplication({
      agentId: input.agentId,
      applicationId: publicCommand.target.id,
    })
    if (!application || application.automationState !== 'PREPARING_DRAFT' ||
      !application.reviewedAt || !application.dossierHash) {
      throw new ConnectorCommandError('COMMAND_NOT_FOUND')
    }
    let dossier: ApplicationDossierV2
    try {
      dossier = parseApplicationDossierV2(application.dossier)
    } catch {
      throw new ConnectorCommandError('COMMAND_INVALID')
    }
    const payloadHash = sha256ApplicationDossierV2(dossier)
    if (payloadHash !== application.dossierHash || payloadHash !== publicCommand.params.payloadHash) {
      throw new ConnectorCommandError('COMMAND_INVALID')
    }
    return {
      inputHash: payloadHash,
      snapshot: {
        schemaVersion: 2,
        applicationId: application.id,
        payloadHash,
        dossier,
      },
    }
  }
  if (!['GENERATE_ILLUSTRATION', 'FLEXLIFE_QUOTE'].includes(command.capability)) {
    throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  }
  if (
    publicCommand.target?.kind !== 'ILLUSTRATION' ||
    !('illustrationId' in publicCommand.params) ||
    !('inputHash' in publicCommand.params) ||
    publicCommand.params.illustrationId !== publicCommand.target.id
  ) throw new ConnectorCommandError('COMMAND_INVALID')
  const illustration = await illustrationRepository.findOwnedIllustration({
    agentId: input.agentId,
    illustrationId: publicCommand.target.id,
  })
  if (!illustration) throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  let snapshot: ForesightIllustrationSnapshot | ForesightTermIllustrationSnapshotV1 | FlexLifeQuoteSnapshotV1
  let inputHash: string
  try {
    if (command.capability === 'FLEXLIFE_QUOTE') {
      snapshot = buildFlexLifeQuoteSnapshot(illustration)
      inputHash = flexLifeQuoteInputHash(snapshot)
    } else if (illustration.productName === 'LSW Term' || illustration.productName === 'NL Term') {
      snapshot = buildForesightTermIllustrationSnapshot(illustration)
      inputHash = foresightTermIllustrationInputHash(snapshot)
    } else {
      snapshot = buildForesightIllustrationSnapshot(illustration)
      inputHash = foresightIllustrationInputHash(snapshot)
    }
  } catch {
    throw new ConnectorCommandError('COMMAND_INVALID')
  }
  if (inputHash !== publicCommand.params.inputHash) {
    throw new ConnectorCommandError('COMMAND_INVALID')
  }
  return { inputHash, snapshot }
}

export async function recordDeviceConnectorCommandEvent(
  repository: LocalConnectorCommandDispatchRepository,
  input: {
    agentId: string
    deviceId: string
    commandId: string
    event: unknown
    now?: Date
    policyDetailRepository?: PolicyDetailRepository
    foresightArtifactRepository?: ForesightArtifactRepository
    flexLifeQuoteRepository?: FlexLifeQuoteResultRepository
    applicationDraftReceiptRepository?: ApplicationDraftReceiptRepository
    extractTermPremiums?: (documentBytes: Uint8Array) => Promise<{
      monthlyPremium: number
      annualPremium: number
    }>
    deploymentScope?: string
  },
): Promise<void> {
  const command = await repository.findDeviceOwned({
    agentId: input.agentId,
    deviceId: input.deviceId,
    commandId: input.commandId,
  })
  if (!command) throw new ConnectorCommandError('COMMAND_NOT_FOUND')

  const event = parseConnectorCommandEvent(input.event)
  if (!event || event.commandId !== input.commandId || event.runId !== command.runId) {
    throw new ConnectorCommandError('EVENT_INVALID')
  }
  if (event.type === 'DATA_BATCH' && command.capability === 'READ_POLICY_DETAIL') {
    const publicCommand = toPublicCommand(command)
    const payload = event.payload
    if (
      publicCommand.target?.kind !== 'POLICY' ||
      !payload ||
      Object.keys(payload).length !== 1 ||
      !Object.hasOwn(payload, 'policyDetail') ||
      !input.policyDetailRepository ||
      !input.deploymentScope
    ) throw new ConnectorCommandError('EVENT_INVALID')
    let detail
    try {
      detail = parseNationalLifePolicyDetail(payload.policyDetail as never)
    } catch {
      throw new ConnectorCommandError('EVENT_INVALID')
    }
    await persistNationalLifePolicyDetail(input.policyDetailRepository, {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      policyId: publicCommand.target.id,
      detail,
    })
  }
  if (event.type === 'DATA_BATCH' && command.capability === 'GENERATE_ILLUSTRATION') {
    const publicCommand = toPublicCommand(command)
    const payload = event.payload
    if (publicCommand.target?.kind !== 'ILLUSTRATION' || !('inputHash' in publicCommand.params) ||
      !payload || Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'illustration') ||
      !input.foresightArtifactRepository) throw new ConnectorCommandError('EVENT_INVALID')
    const receipt = parseForesightIllustrationReceipt(payload.illustration) ??
      parseForesightSolvedIllustrationReceipt(payload.illustration) ??
      parseForesightTermIllustrationReceipt(payload.illustration)
    if (!receipt || receipt.inputHash !== publicCommand.params.inputHash) {
      throw new ConnectorCommandError('EVENT_INVALID')
    }
    const artifact = await input.foresightArtifactRepository.findOwnedArtifact({
      agentId: input.agentId,
      illustrationId: publicCommand.target.id,
    })
    if (!artifact || artifact.provider !== 'NATIONAL_LIFE_FORESIGHT' ||
      artifact.externalId !== `${input.agentId}:${receipt.carrierCaseName}` ||
      artifact.productName !== ('productCode' in receipt ? 'FlexLife' : receipt.carrierProduct) ||
      artifact.documentMimeType !== 'application/pdf' || !artifact.documentBytes ||
      artifact.documentBytes.byteLength !== receipt.documentBytes ||
      createHash('sha256').update(artifact.documentBytes).digest('hex') !== receipt.documentSha256) {
      throw new ConnectorCommandError('EVENT_INVALID')
    }
    if (isForesightSolvedIllustrationReceipt(receipt)) {
      if (!input.foresightArtifactRepository.persistSolvedResult) {
        throw new ConnectorCommandError('EVENT_INVALID')
      }
      await input.foresightArtifactRepository.persistSolvedResult({
        agentId: input.agentId,
        illustrationId: publicCommand.target.id,
        solveBasis: receipt.solveBasis,
        faceAmount: receipt.faceAmount,
        monthlyPremium: receipt.monthlyPremium,
        annualPremium: receipt.annualPremium,
      })
    } else if (isForesightTermIllustrationReceipt(receipt)) {
      if (!input.extractTermPremiums || !input.foresightArtifactRepository.persistTermResult) {
        throw new ConnectorCommandError('EVENT_INVALID')
      }
      let premiums
      try {
        premiums = await input.extractTermPremiums(artifact.documentBytes)
      } catch {
        throw new ConnectorCommandError('EVENT_INVALID')
      }
      if (!Number.isFinite(premiums.monthlyPremium) || premiums.monthlyPremium <= 0 ||
        !Number.isFinite(premiums.annualPremium) || premiums.annualPremium <= 0 ||
        Math.abs((premiums.monthlyPremium * 12) - premiums.annualPremium) > 0.01) {
        throw new ConnectorCommandError('EVENT_INVALID')
      }
      await input.foresightArtifactRepository.persistTermResult({
        agentId: input.agentId,
        illustrationId: publicCommand.target.id,
        monthlyPremium: premiums.monthlyPremium,
        annualPremium: premiums.annualPremium,
        ...(receipt.requestedTermDuration && receipt.confirmedTermDuration
          ? {
              requestedTermDuration: receipt.requestedTermDuration,
              confirmedTermDuration: receipt.confirmedTermDuration,
            }
          : {}),
      })
    }
  }
  if (event.type === 'DATA_BATCH' && command.capability === 'FLEXLIFE_QUOTE') {
    const publicCommand = toPublicCommand(command)
    const payload = event.payload
    const quote = payload && Object.keys(payload).length === 1 && Object.hasOwn(payload, 'flexLifeQuote')
      ? payload.flexLifeQuote
      : null
    if (publicCommand.target?.kind !== 'ILLUSTRATION' || !('inputHash' in publicCommand.params) ||
      !quote || typeof quote !== 'object' || Array.isArray(quote) ||
      Object.keys(quote).sort().join(',') !== 'inputHash,response' ||
      (quote as Record<string, unknown>).inputHash !== publicCommand.params.inputHash ||
      !(quote as Record<string, unknown>).response ||
      typeof (quote as Record<string, unknown>).response !== 'object' ||
      Array.isArray((quote as Record<string, unknown>).response) ||
      !input.flexLifeQuoteRepository) throw new ConnectorCommandError('EVENT_INVALID')
    await input.flexLifeQuoteRepository.persistOwnedQuoteResult({
      agentId: input.agentId,
      illustrationId: publicCommand.target.id,
      inputHash: publicCommand.params.inputHash,
      response: (quote as Record<string, unknown>).response as Record<string, unknown>,
    })
  }
  if (event.type === 'DATA_BATCH' && command.capability === 'PREPARE_APPLICATION_DRAFT') {
    const publicCommand = toPublicCommand(command)
    const payload = event.payload
    const receipt = payload && Object.keys(payload).length === 1 &&
      Object.hasOwn(payload, 'applicationDraft')
      ? parseIgoApplicationDraftReceipt(payload.applicationDraft)
      : null
    if (
      publicCommand.target?.kind !== 'APPLICATION' ||
      !('payloadHash' in publicCommand.params) ||
      !receipt ||
      receipt.applicationId !== publicCommand.target.id ||
      receipt.payloadHash !== publicCommand.params.payloadHash ||
      !input.applicationDraftReceiptRepository
    ) throw new ConnectorCommandError('EVENT_INVALID')
    await input.applicationDraftReceiptRepository.persistOwnedDraftReceipt({
      agentId: input.agentId,
      applicationId: publicCommand.target.id,
      receipt,
    })
  }
  if (command.capability === 'PREPARE_APPLICATION_DRAFT' && event.type === 'COMMAND_COMPLETED' &&
    !command.events.some((existing) => existing.type === 'DATA_BATCH')) {
    throw new ConnectorCommandError('EVENT_INVALID')
  }
  if (command.capability === 'PREPARE_APPLICATION_DRAFT' && event.type === 'COMMAND_FAILED') {
    const publicCommand = toPublicCommand(command)
    if (publicCommand.target?.kind !== 'APPLICATION' ||
      !input.applicationDraftReceiptRepository?.persistOwnedDraftFailure) {
      throw new ConnectorCommandError('EVENT_INVALID')
    }
    await input.applicationDraftReceiptRepository.persistOwnedDraftFailure({
      agentId: input.agentId,
      applicationId: publicCommand.target.id,
      safeErrorCode: event.error?.code ?? 'IGO_DRAFT_FAILED',
    })
  }

  await recordConnectorCommandEvent(repository, {
    agentId: input.agentId,
    event,
    now: input.now,
  })
}
