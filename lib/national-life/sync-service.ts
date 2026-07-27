import { Prisma, type ApplicationStatus, type Prisma as PrismaNamespace, type RequirementStatus, type SyncStatus } from '@prisma/client'
import { buildExternalEventKey } from '@/lib/integrations/idempotency'
import { prisma } from '@/lib/prisma'
import type { NationalLifeCaseObservation } from '@/workers/national-life/types'
import { NATIONAL_LIFE_PROVIDER } from './constants'
import { mapApplicationStatus, mapRequirementStatus, type MappedStatus } from './status-map'

type ApplicationRecord = {
  id: string
  caseId: string
  provider: string | null
  externalId: string | null
  status: ApplicationStatus
  sourceUpdatedAt: Date | null
  rawPayload: PrismaNamespace.JsonValue | null
}

type RequirementRecord = {
  id: string
  applicationId: string
  provider: string | null
  externalId: string | null
  title: string
  description: string | null
  dueAt: Date | null
  receivedAt: Date | null
  sourceUpdatedAt: Date | null
  status: RequirementStatus
}

type ExternalReferenceRecord = {
  id: string
  entityType: string
  entityId: string
  provider: string
  externalId: string
  sourceUpdatedAt: Date | null
  metadata: PrismaNamespace.JsonValue | null
}

type TimelineEventRecord = {
  id: string
  caseId: string
  type: string
  title: string
  body: string | null
  metadata: PrismaNamespace.JsonValue | null
  createdAt: Date
}

type SyncEventRecord = {
  id: string
  integrationConnectionId: string | null
  provider: string
  externalId: string
  sourceUpdatedAt: Date | null
  direction: string
  eventType: string
  status: SyncStatus
  payload: PrismaNamespace.JsonValue | null
  attemptCount: number
  lastError: string | null
  processedAt: Date | null
}

type IntegrationConnectionRecord = {
  id: string
  provider: string
}

type LockedApplicationContext = {
  application: ApplicationRecord
  requirements: RequirementRecord[]
}

type ApplicationUpdateInput = {
  id: string
  provider: string
  externalId: string
  status: ApplicationStatus
  sourceUpdatedAt: Date
  rawPayload: PrismaNamespace.JsonValue
}

type RequirementUpsertInput = {
  applicationId: string
  provider: string
  externalId: string
  title: string
  description?: string | null
  dueAt?: Date | null
  receivedAt?: Date | null
  sourceUpdatedAt: Date
  status: RequirementStatus
}

type ExternalReferenceUpsertInput = {
  entityType: string
  entityId: string
  provider: string
  externalId: string
  sourceUpdatedAt: Date
  metadata: PrismaNamespace.JsonValue
}

type TimelineEventCreateInput = {
  caseId: string
  type: string
  title: string
  body?: string | null
  metadata: PrismaNamespace.JsonValue
  createdAt: Date
}

type SyncEventUpsertInput = {
  integrationConnectionId?: string | null
  provider: string
  externalId: string
  sourceUpdatedAt: Date
  direction: string
  eventType: string
  status: SyncStatus
  payload: PrismaNamespace.JsonValue
  attemptCount?: number
  lastError?: string | null
  processedAt?: Date | null
}

export type NationalLifeSyncTransaction = {
  lockAuthorizedApplication(input: {
    agentId: string
    caseId: string
    applicationId: string
  }): Promise<LockedApplicationContext | null>
  findExternalReferenceByProviderExternalId(input: {
    provider: string
    externalId: string
  }): Promise<ExternalReferenceRecord | null>
  findIntegrationConnectionByProvider(provider: string): Promise<IntegrationConnectionRecord | null>
  upsertExternalReference(input: ExternalReferenceUpsertInput): Promise<ExternalReferenceRecord>
  saveApplication(input: ApplicationUpdateInput): Promise<ApplicationRecord>
  upsertRequirementByExternalId(input: RequirementUpsertInput): Promise<RequirementRecord>
  listTimelineEvents(caseId: string): Promise<TimelineEventRecord[]>
  createTimelineEvent(input: TimelineEventCreateInput): Promise<TimelineEventRecord>
  upsertSyncEvent(input: SyncEventUpsertInput): Promise<SyncEventRecord>
}

export type NationalLifeSyncRepository = {
  transaction<T>(callback: (tx: NationalLifeSyncTransaction) => Promise<T>): Promise<T>
}

export type ApplyCaseObservationInput = {
  agentId: string
  caseId: string
  applicationId: string
  jobId: string
  observation: NationalLifeCaseObservation
}

export type ApplyCaseObservationResult = {
  changed: boolean
  requirementChanges: number
  communicationChanges: number
}

export type NationalLifeSyncServiceDeps = {
  repository?: NationalLifeSyncRepository
}

type FilteredRequirementPayload = {
  externalId: string
  title: string
  carrierStatus: MappedStatus<RequirementStatus>
  dueAt?: string
}

type FilteredCommunicationPayload = {
  externalId: string
  title: string
  occurredAt: string
}

type FilteredDocumentPayload = {
  externalId: string
  filename: string
  contentType?: string
  availableAt?: string
}

type FilteredObservationPayload = {
  application: {
    externalApplicationId: string
    carrierStatus: MappedStatus<ApplicationStatus>
    observedAt: string
  }
  requirements: FilteredRequirementPayload[]
  communications: FilteredCommunicationPayload[]
  documents: FilteredDocumentPayload[]
}

class NationalLifeSyncError extends Error {}

function parseObservedAt(value: string) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    throw new NationalLifeSyncError('Observation observedAt must be a valid date-time')
  }

  return parsed
}

function parseDueAt(value?: string) {
  if (!value) {
    return null
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)

  if (Number.isNaN(parsed.getTime())) {
    throw new NationalLifeSyncError('Requirement dueAt must be a valid date')
  }

  return parsed
}

function compareDates(left: Date | null | undefined, right: Date | null | undefined) {
  if (!left && !right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.getTime() === right.getTime()
}

function compareJson(left: PrismaNamespace.JsonValue | null | undefined, right: PrismaNamespace.JsonValue | null | undefined) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function getMetadataEventKey(metadata: PrismaNamespace.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  const eventKey = (metadata as Record<string, unknown>).eventKey
  return typeof eventKey === 'string' ? eventKey : null
}

function getStoredCarrierStatusOriginal(rawPayload: PrismaNamespace.JsonValue | null | undefined) {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return null
  }

  const application = (rawPayload as Record<string, unknown>).application
  if (!application || typeof application !== 'object' || Array.isArray(application)) {
    return null
  }

  const carrierStatus = (application as Record<string, unknown>).carrierStatus
  if (!carrierStatus || typeof carrierStatus !== 'object' || Array.isArray(carrierStatus)) {
    return null
  }

  const original = (carrierStatus as Record<string, unknown>).original
  return typeof original === 'string' ? original : null
}

function buildFilteredObservationPayload(
  observation: NationalLifeCaseObservation,
  applicationStatus: MappedStatus<ApplicationStatus>,
  requirementStatuses: Map<string, MappedStatus<RequirementStatus>>,
): FilteredObservationPayload {
  return {
    application: {
      externalApplicationId: observation.externalApplicationId,
      carrierStatus: applicationStatus,
      observedAt: observation.observedAt,
    },
    requirements: observation.requirements.map((requirement) => ({
      externalId: requirement.externalId,
      title: requirement.title,
      carrierStatus: requirementStatuses.get(requirement.externalId) ?? mapRequirementStatus(requirement.carrierStatus),
      ...(requirement.dueAt ? { dueAt: requirement.dueAt } : {}),
    })),
    communications: observation.communications.map((communication) => ({
      externalId: communication.externalId,
      title: communication.title,
      occurredAt: communication.occurredAt,
    })),
    documents: observation.documents.map((document) => ({
      externalId: document.externalId,
      filename: document.filename,
      ...(document.contentType ? { contentType: document.contentType } : {}),
      ...(document.availableAt ? { availableAt: document.availableAt } : {}),
    })),
  }
}

function buildApplicationStatusEventKey(
  observation: NationalLifeCaseObservation,
  applicationStatus: MappedStatus<ApplicationStatus>,
): string {
  return buildExternalEventKey(
    NATIONAL_LIFE_PROVIDER,
    `application-status:${observation.externalApplicationId}:${observation.observedAt}:${applicationStatus.normalized}:${applicationStatus.original}`,
  )
}

function buildCommunicationEventKey(externalId: string): string {
  return buildExternalEventKey(NATIONAL_LIFE_PROVIDER, `communication:${externalId}`)
}

function createStatusEventMetadata(input: {
  observation: NationalLifeCaseObservation
  applicationStatus: MappedStatus<ApplicationStatus>
  eventKey: string
}) {
  return {
    eventKey: input.eventKey,
    provider: NATIONAL_LIFE_PROVIDER,
    applicationExternalId: input.observation.externalApplicationId,
    observedAt: input.observation.observedAt,
    carrierStatus: input.applicationStatus,
  } satisfies PrismaNamespace.JsonObject
}

function createCommunicationEventMetadata(input: {
  communication: NationalLifeCaseObservation['communications'][number]
  eventKey: string
}) {
  return {
    eventKey: input.eventKey,
    provider: NATIONAL_LIFE_PROVIDER,
    communicationExternalId: input.communication.externalId,
    occurredAt: input.communication.occurredAt,
  } satisfies PrismaNamespace.JsonObject
}

function hasApplicationStatusChanged(
  current: ApplicationRecord,
  observation: NationalLifeCaseObservation,
  applicationStatus: MappedStatus<ApplicationStatus>,
) {
  return (
    current.provider !== NATIONAL_LIFE_PROVIDER ||
    current.externalId !== observation.externalApplicationId ||
    current.status !== applicationStatus.normalized ||
    current.sourceUpdatedAt?.getTime() !== parseObservedAt(observation.observedAt).getTime() ||
    getStoredCarrierStatusOriginal(current.rawPayload) !== applicationStatus.original
  )
}

function hasRequirementChanged(current: RequirementRecord | undefined, next: RequirementUpsertInput) {
  if (!current) {
    return true
  }

  return (
    current.title !== next.title ||
    (current.description ?? null) !== (next.description ?? null) ||
    current.status !== next.status ||
    !compareDates(current.dueAt, next.dueAt ?? null) ||
    !compareDates(current.receivedAt, next.receivedAt ?? null) ||
    !compareDates(current.sourceUpdatedAt, next.sourceUpdatedAt)
  )
}

const prismaSyncRepository: NationalLifeSyncRepository = {
  async transaction<T>(callback: (tx: NationalLifeSyncTransaction) => Promise<T>) {
    return prisma.$transaction(async (tx) => {
      const repositoryTx: NationalLifeSyncTransaction = {
        async lockAuthorizedApplication({ agentId, caseId, applicationId }) {
          const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT a.id
            FROM "Application" a
            INNER JOIN "InsuranceCase" c ON c.id = a."caseId"
            WHERE a.id = ${applicationId}
              AND a."caseId" = ${caseId}
              AND c."assignedAgentId" = ${agentId}
            FOR UPDATE
          `)

          if (locked.length === 0) {
            return null
          }

          const application = await tx.application.findUnique({
            where: { id: applicationId },
            select: {
              id: true,
              caseId: true,
              provider: true,
              externalId: true,
              status: true,
              sourceUpdatedAt: true,
              rawPayload: true,
              requirements: {
                select: {
                  id: true,
                  applicationId: true,
                  provider: true,
                  externalId: true,
                  title: true,
                  description: true,
                  dueAt: true,
                  receivedAt: true,
                  sourceUpdatedAt: true,
                  status: true,
                },
              },
            },
          })

          if (!application) {
            return null
          }

          return {
            application: {
              id: application.id,
              caseId: application.caseId,
              provider: application.provider,
              externalId: application.externalId,
              status: application.status,
              sourceUpdatedAt: application.sourceUpdatedAt,
              rawPayload: application.rawPayload,
            },
            requirements: application.requirements,
          }
        },

        async findExternalReferenceByProviderExternalId({ provider, externalId }) {
          return tx.externalReference.findUnique({
            where: {
              provider_externalId: {
                provider,
                externalId,
              },
            },
            select: {
              id: true,
              entityType: true,
              entityId: true,
              provider: true,
              externalId: true,
              sourceUpdatedAt: true,
              metadata: true,
            },
          })
        },

        async findIntegrationConnectionByProvider(provider) {
          return tx.integrationConnection.findUnique({
            where: { provider },
            select: {
              id: true,
              provider: true,
            },
          })
        },

        async upsertExternalReference(input) {
          return tx.externalReference.upsert({
            where: {
              provider_externalId: {
                provider: input.provider,
                externalId: input.externalId,
              },
            },
            create: {
              entityType: input.entityType,
              entityId: input.entityId,
              provider: input.provider,
              externalId: input.externalId,
              sourceUpdatedAt: input.sourceUpdatedAt,
              metadata: input.metadata as PrismaNamespace.InputJsonValue,
            },
            update: {
              entityType: input.entityType,
              entityId: input.entityId,
              sourceUpdatedAt: input.sourceUpdatedAt,
              metadata: input.metadata as PrismaNamespace.InputJsonValue,
            },
            select: {
              id: true,
              entityType: true,
              entityId: true,
              provider: true,
              externalId: true,
              sourceUpdatedAt: true,
              metadata: true,
            },
          })
        },

        async saveApplication(input) {
          return tx.application.update({
            where: { id: input.id },
            data: {
              provider: input.provider,
              externalId: input.externalId,
              status: input.status,
              sourceUpdatedAt: input.sourceUpdatedAt,
              rawPayload: input.rawPayload as PrismaNamespace.InputJsonValue,
            },
            select: {
              id: true,
              caseId: true,
              provider: true,
              externalId: true,
              status: true,
              sourceUpdatedAt: true,
              rawPayload: true,
            },
          })
        },

        async upsertRequirementByExternalId(input) {
          const existing = await tx.applicationRequirement.findUnique({
            where: {
              provider_externalId: {
                provider: input.provider,
                externalId: input.externalId,
              },
            },
            select: {
              id: true,
              applicationId: true,
              provider: true,
              externalId: true,
              title: true,
              description: true,
              dueAt: true,
              receivedAt: true,
              sourceUpdatedAt: true,
              status: true,
            },
          })

          if (existing && existing.applicationId !== input.applicationId) {
            throw new NationalLifeSyncError('National Life requirement external id belongs to another application')
          }

          if (existing) {
            return tx.applicationRequirement.update({
              where: { id: existing.id },
              data: {
                title: input.title,
                description: input.description ?? null,
                dueAt: input.dueAt ?? null,
                receivedAt: input.receivedAt ?? null,
                sourceUpdatedAt: input.sourceUpdatedAt,
                status: input.status,
              },
              select: {
                id: true,
                applicationId: true,
                provider: true,
                externalId: true,
                title: true,
                description: true,
                dueAt: true,
                receivedAt: true,
                sourceUpdatedAt: true,
                status: true,
              },
            })
          }

          return tx.applicationRequirement.create({
            data: {
              applicationId: input.applicationId,
              provider: input.provider,
              externalId: input.externalId,
              title: input.title,
              description: input.description ?? null,
              dueAt: input.dueAt ?? null,
              receivedAt: input.receivedAt ?? null,
              sourceUpdatedAt: input.sourceUpdatedAt,
              status: input.status,
            },
            select: {
              id: true,
              applicationId: true,
              provider: true,
              externalId: true,
              title: true,
              description: true,
              dueAt: true,
              receivedAt: true,
              sourceUpdatedAt: true,
              status: true,
            },
          })
        },

        async listTimelineEvents(caseId) {
          return tx.caseTimelineEvent.findMany({
            where: { caseId },
            select: {
              id: true,
              caseId: true,
              type: true,
              title: true,
              body: true,
              metadata: true,
              createdAt: true,
            },
          })
        },

        async createTimelineEvent(input) {
          return tx.caseTimelineEvent.create({
            data: {
              caseId: input.caseId,
              type: input.type,
              title: input.title,
              body: input.body ?? null,
              metadata: input.metadata as PrismaNamespace.InputJsonValue,
              createdAt: input.createdAt,
            },
            select: {
              id: true,
              caseId: true,
              type: true,
              title: true,
              body: true,
              metadata: true,
              createdAt: true,
            },
          })
        },

        async upsertSyncEvent(input) {
          return tx.syncEvent.upsert({
            where: {
              provider_externalId: {
                provider: input.provider,
                externalId: input.externalId,
              },
            },
            create: {
              integrationConnectionId: input.integrationConnectionId ?? null,
              provider: input.provider,
              externalId: input.externalId,
              sourceUpdatedAt: input.sourceUpdatedAt,
              direction: input.direction,
              eventType: input.eventType,
              status: input.status,
              payload: input.payload as PrismaNamespace.InputJsonValue,
              attemptCount: input.attemptCount ?? 0,
              lastError: input.lastError ?? null,
              processedAt: input.processedAt ?? null,
            },
            update: {
              integrationConnectionId: input.integrationConnectionId ?? null,
              sourceUpdatedAt: input.sourceUpdatedAt,
              direction: input.direction,
              eventType: input.eventType,
              status: input.status,
              payload: input.payload as PrismaNamespace.InputJsonValue,
              attemptCount: input.attemptCount,
              lastError: input.lastError ?? null,
              processedAt: input.processedAt ?? null,
            },
            select: {
              id: true,
              integrationConnectionId: true,
              provider: true,
              externalId: true,
              sourceUpdatedAt: true,
              direction: true,
              eventType: true,
              status: true,
              payload: true,
              attemptCount: true,
              lastError: true,
              processedAt: true,
            },
          })
        },
      }

      return callback(repositoryTx)
    })
  },
}

function resolveRepository(deps?: NationalLifeSyncServiceDeps) {
  return deps?.repository ?? prismaSyncRepository
}

export async function applyCaseObservation(
  input: ApplyCaseObservationInput,
  deps?: NationalLifeSyncServiceDeps,
): Promise<ApplyCaseObservationResult> {
  const repository = resolveRepository(deps)

  return repository.transaction(async (tx) => {
    const locked = await tx.lockAuthorizedApplication({
      agentId: input.agentId,
      caseId: input.caseId,
      applicationId: input.applicationId,
    })

    if (!locked) {
      throw new NationalLifeSyncError('National Life application not found for the provided agent and case scope')
    }

    const observedAt = parseObservedAt(input.observation.observedAt)
    const applicationStatus = mapApplicationStatus(input.observation.carrierStatus)
    const requirementStatuses = new Map<string, MappedStatus<RequirementStatus>>()
    const filteredPayload = buildFilteredObservationPayload(
      input.observation,
      applicationStatus,
      input.observation.requirements.reduce((map, requirement) => {
        const mapped = mapRequirementStatus(requirement.carrierStatus)
        map.set(requirement.externalId, mapped)
        requirementStatuses.set(requirement.externalId, mapped)
        return map
      }, new Map<string, MappedStatus<RequirementStatus>>()),
    )

    if (
      locked.application.externalId &&
      locked.application.externalId !== input.observation.externalApplicationId
    ) {
      throw new NationalLifeSyncError(
        'National Life observation external application id does not match the existing application external application id',
      )
    }

    const existingExternalReference = await tx.findExternalReferenceByProviderExternalId({
      provider: NATIONAL_LIFE_PROVIDER,
      externalId: input.observation.externalApplicationId,
    })

    if (existingExternalReference && existingExternalReference.entityId !== locked.application.id) {
      throw new NationalLifeSyncError('National Life external application id already belongs to another entity')
    }

    await tx.upsertExternalReference({
      entityType: 'APPLICATION',
      entityId: locked.application.id,
      provider: NATIONAL_LIFE_PROVIDER,
      externalId: input.observation.externalApplicationId,
      sourceUpdatedAt: observedAt,
      metadata: {
        observedAt: input.observation.observedAt,
        carrierStatus: applicationStatus,
      } satisfies PrismaNamespace.JsonObject,
    })

    const applicationStatusChanged = hasApplicationStatusChanged(
      locked.application,
      input.observation,
      applicationStatus,
    )
    const nextApplication: ApplicationUpdateInput = {
      id: locked.application.id,
      provider: NATIONAL_LIFE_PROVIDER,
      externalId: input.observation.externalApplicationId,
      status: applicationStatus.normalized,
      sourceUpdatedAt: observedAt,
      rawPayload: filteredPayload,
    }

    const applicationChanged =
      locked.application.provider !== nextApplication.provider ||
      locked.application.externalId !== nextApplication.externalId ||
      locked.application.status !== nextApplication.status ||
      !compareDates(locked.application.sourceUpdatedAt, nextApplication.sourceUpdatedAt) ||
      !compareJson(locked.application.rawPayload, nextApplication.rawPayload)

    if (applicationChanged) {
      await tx.saveApplication(nextApplication)
    }

    let requirementChanges = 0
    const requirementsByExternalId = new Map(
      locked.requirements
        .filter((requirement) => requirement.provider === NATIONAL_LIFE_PROVIDER && requirement.externalId)
        .map((requirement) => [requirement.externalId as string, requirement]),
    )

    for (const requirement of input.observation.requirements) {
      const mappedStatus = requirementStatuses.get(requirement.externalId) ?? mapRequirementStatus(requirement.carrierStatus)
      const current = requirementsByExternalId.get(requirement.externalId)
      const nextRequirement: RequirementUpsertInput = {
        applicationId: locked.application.id,
        provider: NATIONAL_LIFE_PROVIDER,
        externalId: requirement.externalId,
        title: requirement.title,
        description: requirement.description ?? null,
        dueAt: parseDueAt(requirement.dueAt),
        receivedAt:
          mappedStatus.normalized === 'RECEIVED'
            ? current?.receivedAt ?? observedAt
            : null,
        sourceUpdatedAt: observedAt,
        status: mappedStatus.normalized,
      }

      if (hasRequirementChanged(current, nextRequirement)) {
        requirementChanges += 1
      }

      const persisted = await tx.upsertRequirementByExternalId(nextRequirement)
      requirementsByExternalId.set(requirement.externalId, persisted)
    }

    const existingTimelineEvents = await tx.listTimelineEvents(input.caseId)
    const existingEventKeys = new Set(
      existingTimelineEvents
        .map((event) => getMetadataEventKey(event.metadata))
        .filter((eventKey): eventKey is string => Boolean(eventKey)),
    )

    if (applicationStatusChanged) {
      const eventKey = buildApplicationStatusEventKey(input.observation, applicationStatus)
      if (!existingEventKeys.has(eventKey)) {
        await tx.createTimelineEvent({
          caseId: input.caseId,
          type: 'CARRIER_APPLICATION_STATUS',
          title: `National Life status: ${applicationStatus.original}`,
          body: `Application ${input.observation.externalApplicationId} observed as ${applicationStatus.original}.`,
          metadata: createStatusEventMetadata({
            observation: input.observation,
            applicationStatus,
            eventKey,
          }),
          createdAt: observedAt,
        })
        existingEventKeys.add(eventKey)
      }
    }

    let communicationChanges = 0

    for (const communication of input.observation.communications) {
      const eventKey = buildCommunicationEventKey(communication.externalId)

      if (existingEventKeys.has(eventKey)) {
        continue
      }

      const occurredAt = parseObservedAt(communication.occurredAt)
      await tx.createTimelineEvent({
        caseId: input.caseId,
        type: 'CARRIER_COMMUNICATION',
        title: `National Life: ${communication.title}`,
        metadata: createCommunicationEventMetadata({
          communication,
          eventKey,
        }),
        createdAt: occurredAt,
      })
      existingEventKeys.add(eventKey)
      communicationChanges += 1
    }

    const integrationConnection = await tx.findIntegrationConnectionByProvider(NATIONAL_LIFE_PROVIDER)

    await tx.upsertSyncEvent({
      integrationConnectionId: integrationConnection?.id ?? null,
      provider: NATIONAL_LIFE_PROVIDER,
      externalId: `${NATIONAL_LIFE_PROVIDER}:${input.jobId}`,
      sourceUpdatedAt: observedAt,
      direction: 'INBOUND',
      eventType: 'CASE_OBSERVATION',
      status: 'SUCCEEDED',
      payload: filteredPayload,
      processedAt: observedAt,
    })

    return {
      changed: applicationChanged || requirementChanges > 0 || communicationChanges > 0,
      requirementChanges,
      communicationChanges,
    }
  })
}
