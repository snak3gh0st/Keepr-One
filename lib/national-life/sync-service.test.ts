import type { ApplicationStatus, Prisma, RequirementStatus, SyncStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import type { NationalLifeCaseObservation } from '@/workers/national-life/types'
import {
  applyCaseObservation,
  type NationalLifeSyncRepository,
  type NationalLifeSyncTransaction,
} from './sync-service'

type ApplicationRecord = {
  id: string
  caseId: string
  assignedAgentId: string
  provider: string | null
  externalId: string | null
  status: ApplicationStatus
  sourceUpdatedAt: Date | null
  rawPayload: Prisma.JsonValue | null
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
  metadata: Prisma.JsonValue | null
}

type TimelineEventRecord = {
  id: string
  caseId: string
  type: string
  title: string
  body: string | null
  metadata: Prisma.JsonValue | null
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
  payload: Prisma.JsonValue | null
  attemptCount: number
  lastError: string | null
  processedAt: Date | null
}

type IntegrationConnectionRecord = {
  id: string
  provider: string
}

type SeedState = {
  applications?: ApplicationRecord[]
  requirements?: RequirementRecord[]
  externalReferences?: ExternalReferenceRecord[]
  timelineEvents?: TimelineEventRecord[]
  syncEvents?: SyncEventRecord[]
  integrationConnections?: IntegrationConnectionRecord[]
}

class InMemoryNationalLifeSyncRepository implements NationalLifeSyncRepository {
  policyCreateCalls = 0

  private readonly applications = new Map<string, ApplicationRecord>()
  private readonly requirements = new Map<string, RequirementRecord>()
  private readonly externalReferences = new Map<string, ExternalReferenceRecord>()
  private readonly timelineEvents = new Map<string, TimelineEventRecord>()
  private readonly syncEvents = new Map<string, SyncEventRecord>()
  private readonly integrationConnections = new Map<string, IntegrationConnectionRecord>()
  private nextId = 1

  constructor(seed: SeedState = {}) {
    seed.applications?.forEach((application) => this.applications.set(application.id, structuredClone(application)))
    seed.requirements?.forEach((requirement) => this.requirements.set(requirement.id, structuredClone(requirement)))
    seed.externalReferences?.forEach((reference) =>
      this.externalReferences.set(reference.id, structuredClone(reference)),
    )
    seed.timelineEvents?.forEach((event) => this.timelineEvents.set(event.id, structuredClone(event)))
    seed.syncEvents?.forEach((event) => this.syncEvents.set(event.id, structuredClone(event)))
    seed.integrationConnections?.forEach((connection) =>
      this.integrationConnections.set(connection.id, structuredClone(connection)),
    )
  }

  async transaction<T>(callback: (tx: NationalLifeSyncTransaction) => Promise<T>): Promise<T> {
    return callback({
      lockAuthorizedApplication: async ({ agentId, caseId, applicationId }) => {
        const application = this.applications.get(applicationId)
        if (!application || application.caseId !== caseId || application.assignedAgentId !== agentId) {
          return null
        }

        return {
          application: structuredClone(application),
          requirements: Array.from(this.requirements.values())
            .filter((requirement) => requirement.applicationId === applicationId)
            .map((requirement) => structuredClone(requirement)),
        }
      },

      findExternalReferenceByProviderExternalId: async ({ provider, externalId }) => {
        return (
          Array.from(this.externalReferences.values()).find(
            (reference) => reference.provider === provider && reference.externalId === externalId,
          ) ?? null
        )
      },

      findIntegrationConnectionByProvider: async (provider) => {
        return Array.from(this.integrationConnections.values()).find((connection) => connection.provider === provider) ?? null
      },

      upsertExternalReference: async (input) => {
        const existing = Array.from(this.externalReferences.values()).find(
          (reference) => reference.provider === input.provider && reference.externalId === input.externalId,
        )

        if (existing) {
          const updated: ExternalReferenceRecord = {
            ...existing,
            entityType: input.entityType,
            entityId: input.entityId,
            sourceUpdatedAt: input.sourceUpdatedAt,
            metadata: structuredClone(input.metadata),
          }
          this.externalReferences.set(existing.id, updated)
          return structuredClone(updated)
        }

        const created: ExternalReferenceRecord = {
          id: this.allocateId('xref'),
          entityType: input.entityType,
          entityId: input.entityId,
          provider: input.provider,
          externalId: input.externalId,
          sourceUpdatedAt: input.sourceUpdatedAt,
          metadata: structuredClone(input.metadata),
        }
        this.externalReferences.set(created.id, created)
        return structuredClone(created)
      },

      saveApplication: async (input) => {
        const existing = this.applications.get(input.id)
        if (!existing) {
          throw new Error(`Unknown application ${input.id}`)
        }

        const updated: ApplicationRecord = {
          ...existing,
          provider: input.provider,
          externalId: input.externalId,
          status: input.status,
          sourceUpdatedAt: input.sourceUpdatedAt,
          rawPayload: structuredClone(input.rawPayload),
        }
        this.applications.set(updated.id, updated)
        return structuredClone(updated)
      },
      advanceCaseCrmStage: async () => undefined,

      upsertRequirementByExternalId: async (input) => {
        const existing = Array.from(this.requirements.values()).find(
          (requirement) => requirement.provider === input.provider && requirement.externalId === input.externalId,
        )

        if (existing) {
          if (existing.applicationId !== input.applicationId) {
            throw new Error('Requirement external id belongs to another application')
          }

          const updated: RequirementRecord = {
            ...existing,
            title: input.title,
            description: input.description ?? null,
            dueAt: input.dueAt ?? null,
            receivedAt: input.receivedAt ?? null,
            sourceUpdatedAt: input.sourceUpdatedAt,
            status: input.status,
          }
          this.requirements.set(updated.id, updated)
          return structuredClone(updated)
        }

        const created: RequirementRecord = {
          id: this.allocateId('req'),
          applicationId: input.applicationId,
          provider: input.provider,
          externalId: input.externalId,
          title: input.title,
          description: input.description ?? null,
          dueAt: input.dueAt ?? null,
          receivedAt: input.receivedAt ?? null,
          sourceUpdatedAt: input.sourceUpdatedAt,
          status: input.status,
        }
        this.requirements.set(created.id, created)
        return structuredClone(created)
      },

      listTimelineEvents: async (caseId) => {
        return Array.from(this.timelineEvents.values())
          .filter((event) => event.caseId === caseId)
          .map((event) => structuredClone(event))
      },

      createTimelineEvent: async (input) => {
        const created: TimelineEventRecord = {
          id: this.allocateId('tle'),
          caseId: input.caseId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          metadata: structuredClone(input.metadata),
          createdAt: input.createdAt,
        }
        this.timelineEvents.set(created.id, created)
        return structuredClone(created)
      },

      upsertSyncEvent: async (input) => {
        const existing = Array.from(this.syncEvents.values()).find(
          (event) => event.provider === input.provider && event.externalId === input.externalId,
        )

        if (existing) {
          const updated: SyncEventRecord = {
            ...existing,
            integrationConnectionId: input.integrationConnectionId ?? null,
            sourceUpdatedAt: input.sourceUpdatedAt,
            direction: input.direction,
            eventType: input.eventType,
            status: input.status,
            payload: structuredClone(input.payload),
            processedAt: input.processedAt ?? null,
            lastError: input.lastError ?? null,
            attemptCount: input.attemptCount ?? existing.attemptCount,
          }
          this.syncEvents.set(updated.id, updated)
          return structuredClone(updated)
        }

        const created: SyncEventRecord = {
          id: this.allocateId('sync'),
          integrationConnectionId: input.integrationConnectionId ?? null,
          provider: input.provider,
          externalId: input.externalId,
          sourceUpdatedAt: input.sourceUpdatedAt,
          direction: input.direction,
          eventType: input.eventType,
          status: input.status,
          payload: structuredClone(input.payload),
          processedAt: input.processedAt ?? null,
          lastError: input.lastError ?? null,
          attemptCount: input.attemptCount ?? 0,
        }
        this.syncEvents.set(created.id, created)
        return structuredClone(created)
      },
    })
  }

  snapshot() {
    return {
      applications: Array.from(this.applications.values()).map((value) => structuredClone(value)),
      requirements: Array.from(this.requirements.values()).map((value) => structuredClone(value)),
      externalReferences: Array.from(this.externalReferences.values()).map((value) => structuredClone(value)),
      timelineEvents: Array.from(this.timelineEvents.values()).map((value) => structuredClone(value)),
      syncEvents: Array.from(this.syncEvents.values()).map((value) => structuredClone(value)),
    }
  }

  private allocateId(prefix: string) {
    const id = `${prefix}-${this.nextId}`
    this.nextId += 1
    return id
  }
}

function buildObservation(overrides: Partial<NationalLifeCaseObservation> = {}): NationalLifeCaseObservation {
  return {
    externalApplicationId: overrides.externalApplicationId ?? 'NLG-123',
    carrierStatus: overrides.carrierStatus ?? 'Underwriting',
    observedAt: overrides.observedAt ?? '2026-07-27T13:00:00.000Z',
    requirements: overrides.requirements ?? [
      {
        externalId: 'REQ-1',
        title: 'APS Statement',
        description: 'Collect full attending physician statement',
        carrierStatus: 'Outstanding',
        dueAt: '2026-08-10',
      },
    ],
    communications: overrides.communications ?? [],
    documents: overrides.documents ?? [
      {
        externalId: 'DOC-1',
        filename: 'case-summary.pdf',
        contentType: 'application/pdf',
        availableAt: '2026-07-27T12:55:00.000Z',
      },
    ],
  }
}

function createRepository(seed: SeedState = {}) {
  return new InMemoryNationalLifeSyncRepository({
    applications: [
      {
        id: 'app-1',
        caseId: 'case-1',
        assignedAgentId: 'agent-1',
        provider: null,
        externalId: null,
        status: 'DRAFT',
        sourceUpdatedAt: null,
        rawPayload: null,
      },
      ...(seed.applications ?? []),
    ],
    integrationConnections: [{ id: 'conn-1', provider: 'NATIONAL_LIFE' }, ...(seed.integrationConnections ?? [])],
    requirements: seed.requirements,
    externalReferences: seed.externalReferences,
    timelineEvents: seed.timelineEvents,
    syncEvents: seed.syncEvents,
  })
}

describe('National Life sync service', () => {
  it('upserts application and requirements by NATIONAL_LIFE external id', async () => {
    const repository = createRepository()

    await expect(
      applyCaseObservation(
        {
          agentId: 'agent-1',
          caseId: 'case-1',
          applicationId: 'app-1',
          jobId: 'job-1',
          observation: buildObservation(),
        },
        { repository },
      ),
    ).resolves.toEqual({
      changed: true,
      requirementChanges: 1,
      communicationChanges: 0,
    })

    await applyCaseObservation(
      {
        agentId: 'agent-1',
        caseId: 'case-1',
        applicationId: 'app-1',
        jobId: 'job-2',
        observation: buildObservation({
          carrierStatus: 'Issued',
          observedAt: '2026-07-27T14:00:00.000Z',
          requirements: [
            {
              externalId: 'REQ-1',
              title: 'APS Statement received',
              carrierStatus: 'Received',
            },
          ],
        }),
      },
      { repository },
    )

    const snapshot = repository.snapshot()

    expect(snapshot.applications).toEqual([
      expect.objectContaining({
        id: 'app-1',
        provider: 'NATIONAL_LIFE',
        externalId: 'NLG-123',
        status: 'ISSUED',
      }),
    ])

    expect(snapshot.externalReferences).toEqual([
      expect.objectContaining({
        entityType: 'APPLICATION',
        entityId: 'app-1',
        provider: 'NATIONAL_LIFE',
        externalId: 'NLG-123',
      }),
    ])

    expect(snapshot.requirements).toHaveLength(1)
    expect(snapshot.requirements[0]).toMatchObject({
      applicationId: 'app-1',
      provider: 'NATIONAL_LIFE',
      externalId: 'REQ-1',
      title: 'APS Statement received',
      status: 'RECEIVED',
    })
    expect(snapshot.requirements[0].receivedAt?.toISOString()).toBe('2026-07-27T14:00:00.000Z')
  })

  it('adds one timeline event for a newly observed carrier change', async () => {
    const repository = createRepository()

    await applyCaseObservation(
      {
        agentId: 'agent-1',
        caseId: 'case-1',
        applicationId: 'app-1',
        jobId: 'job-1',
        observation: buildObservation(),
      },
      { repository },
    )

    const snapshot = repository.snapshot()

    expect(snapshot.timelineEvents).toHaveLength(1)
    expect(snapshot.timelineEvents[0]).toMatchObject({
      caseId: 'case-1',
      type: 'CARRIER_APPLICATION_STATUS',
      metadata: expect.objectContaining({
        provider: 'NATIONAL_LIFE',
        applicationExternalId: 'NLG-123',
        eventKey: expect.any(String),
      }),
    })
  })

  it('adds no duplicate records or timeline events when replayed', async () => {
    const repository = createRepository()
    const observation = buildObservation({
      communications: [
        {
          externalId: 'COMM-1',
          title: 'Attending physician statement requested',
          body: 'Long carrier HTML or body should not be persisted',
          occurredAt: '2026-07-27T12:30:00.000Z',
        },
      ],
    })

    await applyCaseObservation(
      {
        agentId: 'agent-1',
        caseId: 'case-1',
        applicationId: 'app-1',
        jobId: 'job-1',
        observation,
      },
      { repository },
    )

    await expect(
      applyCaseObservation(
        {
          agentId: 'agent-1',
          caseId: 'case-1',
          applicationId: 'app-1',
          jobId: 'job-1',
          observation,
        },
        { repository },
      ),
    ).resolves.toEqual({
      changed: false,
      requirementChanges: 0,
      communicationChanges: 0,
    })

    const snapshot = repository.snapshot()

    expect(snapshot.applications).toHaveLength(1)
    expect(snapshot.requirements).toHaveLength(1)
    expect(snapshot.externalReferences).toHaveLength(1)
    expect(snapshot.timelineEvents).toHaveLength(2)
    expect(snapshot.syncEvents).toHaveLength(1)
  })

  it('rejects an observation for a different external application id', async () => {
    const repository = createRepository({
      applications: [
        {
          id: 'app-locked',
          caseId: 'case-2',
          assignedAgentId: 'agent-1',
          provider: 'NATIONAL_LIFE',
          externalId: 'NLG-999',
          status: 'UNDERWRITING',
          sourceUpdatedAt: new Date('2026-07-27T09:00:00.000Z'),
          rawPayload: null,
        },
      ],
    })

    await expect(
      applyCaseObservation(
        {
          agentId: 'agent-1',
          caseId: 'case-2',
          applicationId: 'app-locked',
          jobId: 'job-1',
          observation: buildObservation({ externalApplicationId: 'NLG-123' }),
        },
        { repository },
      ),
    ).rejects.toThrow('external application id')
  })

  it('does not create a Policy when the observed status is Issued', async () => {
    const repository = createRepository()

    await applyCaseObservation(
      {
        agentId: 'agent-1',
        caseId: 'case-1',
        applicationId: 'app-1',
        jobId: 'job-issued',
        observation: buildObservation({ carrierStatus: 'Issued' }),
      },
      { repository },
    )

    expect(repository.policyCreateCalls).toBe(0)
    expect(repository.snapshot().applications[0]?.status).toBe('ISSUED')
  })

  it('stores only filtered source payload fields', async () => {
    const repository = createRepository()

    await applyCaseObservation(
      {
        agentId: 'agent-1',
        caseId: 'case-1',
        applicationId: 'app-1',
        jobId: 'job-filtered',
        observation: buildObservation({
          requirements: [
            {
              externalId: 'REQ-1',
              title: 'APS Statement',
              description: 'Do not persist this internal body',
              carrierStatus: 'Outstanding',
              dueAt: '2026-08-10',
            },
          ],
          communications: [
            {
              externalId: 'COMM-1',
              title: 'Need an APS',
              body: '<html>Do not persist this full carrier body</html>',
              occurredAt: '2026-07-27T12:30:00.000Z',
            },
          ],
        }),
      },
      { repository },
    )

    const snapshot = repository.snapshot()
    const rawPayload = snapshot.applications[0]?.rawPayload as Record<string, unknown>
    const syncPayload = snapshot.syncEvents[0]?.payload as Record<string, unknown>

    expect(rawPayload).toEqual({
      application: {
        externalApplicationId: 'NLG-123',
        carrierStatus: {
          normalized: 'UNDERWRITING',
          original: 'Underwriting',
          recognized: true,
        },
        observedAt: '2026-07-27T13:00:00.000Z',
      },
      requirements: [
        {
          externalId: 'REQ-1',
          title: 'APS Statement',
          carrierStatus: {
            normalized: 'OPEN',
            original: 'Outstanding',
            recognized: true,
          },
          dueAt: '2026-08-10',
        },
      ],
      communications: [
        {
          externalId: 'COMM-1',
          title: 'Need an APS',
          occurredAt: '2026-07-27T12:30:00.000Z',
        },
      ],
      documents: [
        {
          externalId: 'DOC-1',
          filename: 'case-summary.pdf',
          contentType: 'application/pdf',
          availableAt: '2026-07-27T12:55:00.000Z',
        },
      ],
    })

    expect(syncPayload).toEqual(rawPayload)
    expect(JSON.stringify(rawPayload)).not.toContain('Do not persist this internal body')
    expect(JSON.stringify(rawPayload)).not.toContain('<html>')
  })
})
