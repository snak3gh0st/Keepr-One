import { Prisma, type ApplicationStatus, type CaseStage, type CaseStatus, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_CRM_STAGES, type DefaultCrmStageKey } from './constants'
import { CrmDomainError } from './errors'
import type { CrmPipelineView, CrmStageView } from './types'

type PipelineDb = Pick<PrismaClient, 'crmPipeline' | 'crmStage' | 'insuranceCase' | '$transaction'>
type Transaction = Prisma.TransactionClient

const TERMINAL_CASE_STAGES = new Set<CaseStage>(['PLACED', 'DECLINED', 'WITHDRAWN'])

const LEGACY_CASE_STAGE_ORDER: Readonly<Record<Exclude<CaseStage, 'DECLINED' | 'WITHDRAWN'>, number>> = {
  LEAD: 0,
  DISCOVERY: 1,
  DESIGN: 2,
  ILLUSTRATION_READY: 3,
  APPLICATION_STARTED: 4,
  SUBMITTED: 5,
  UNDERWRITING: 6,
  APPROVED: 7,
  ISSUED: 8,
  PLACED: 9,
}

// Dynamic CRM labels describe the commercial journey; CaseStage remains the
// technical source used by application transitions, policy eligibility and BI.
// A CRM move can raise that technical floor, but can never move it backwards.
const CRM_SYSTEM_KEY_LEGACY_FLOOR: Readonly<Partial<Record<DefaultCrmStageKey, CaseStage>>> = {
  NEW_LEAD: 'LEAD',
  FOLLOW_UP: 'LEAD',
  IN_CONTACT: 'DISCOVERY',
  QUALIFIED: 'DESIGN',
  FIRST_MEETING_SCHEDULED: 'DISCOVERY',
  RESCHEDULE_FIRST_MEETING: 'DISCOVERY',
  CREATE_ILLUSTRATION: 'DESIGN',
  ILLUSTRATION_SCHEDULED: 'ILLUSTRATION_READY',
  RESCHEDULE_ILLUSTRATION: 'ILLUSTRATION_READY',
  CONTRACT_CLOSED: 'APPROVED',
  APPLICATION: 'APPLICATION_STARTED',
  POLICY_ISSUED: 'ISSUED',
  ACTIVE_CLIENT: 'PLACED',
  LOST: 'WITHDRAWN',
}

const CRM_SYSTEM_KEY_ORDER = new Map<string, number>(
  DEFAULT_CRM_STAGES.map((stage, index) => [stage.systemKey, index]),
)

export type LockedCaseState = { stage: CaseStage; status: CaseStatus }

type LockedCaseCrmContext = {
  pipelineId: string
  insuranceCase: {
    id: string
    assignedAgentId: string
    crmStage: { id: string; name: string; systemKey: string | null } | null
  }
  technicalState: LockedCaseState
}

export function legacyCaseStateForCrmSystemKey(
  currentStage: CaseStage,
  systemKey: string | null,
): LockedCaseState {
  const target = systemKey
    ? CRM_SYSTEM_KEY_LEGACY_FLOOR[systemKey as DefaultCrmStageKey]
    : undefined

  // A terminal technical decision is durable. In particular, moving a placed
  // client to a board label must not rewrite a sale as withdrawn in BI.
  if (!target || TERMINAL_CASE_STAGES.has(currentStage)) {
    return {
      stage: currentStage,
      status: TERMINAL_CASE_STAGES.has(currentStage) ? 'CLOSED' : 'OPEN',
    }
  }

  if (target === 'WITHDRAWN') return { stage: 'WITHDRAWN', status: 'CLOSED' }

  const currentRank = LEGACY_CASE_STAGE_ORDER[currentStage as keyof typeof LEGACY_CASE_STAGE_ORDER]
  const targetRank = LEGACY_CASE_STAGE_ORDER[target as keyof typeof LEGACY_CASE_STAGE_ORDER]
  const stage = targetRank > currentRank ? target : currentStage
  return { stage, status: TERMINAL_CASE_STAGES.has(stage) ? 'CLOSED' : 'OPEN' }
}

export function crmSystemStageForApplicationStatus(status: ApplicationStatus): DefaultCrmStageKey {
  if (status === 'ISSUED') return 'POLICY_ISSUED'
  if (status === 'DECLINED' || status === 'WITHDRAWN') return 'LOST'
  return 'APPLICATION'
}

export function crmSystemStageForPolicyStatus(status: 'PENDING' | 'APPROVED' | 'INFORCE' | 'LAPSED' | 'CANCELLED'): DefaultCrmStageKey {
  if (status === 'INFORCE') return 'ACTIVE_CLIENT'
  if (status === 'LAPSED' || status === 'CANCELLED') return 'LOST'
  return 'POLICY_ISSUED'
}

async function lockCaseTechnicalState(tx: Transaction, caseId: string): Promise<LockedCaseState> {
  const rows = await tx.$queryRaw<LockedCaseState[]>(Prisma.sql`
    SELECT "stage", "status"
    FROM "InsuranceCase"
    WHERE "id" = ${caseId}
    FOR UPDATE
  `)
  if (!rows[0]) throw new CrmDomainError('CASE_NOT_FOUND', 'Caso não encontrado.')
  return rows[0]
}

async function syncLegacyCaseStateFromCurrent(
  tx: Transaction,
  input: { caseId: string; systemKey: string | null },
  current: LockedCaseState,
) {
  const next = legacyCaseStateForCrmSystemKey(current.stage, input.systemKey)
  if (next.stage !== current.stage || next.status !== current.status) {
    await tx.insuranceCase.update({
      where: { id: input.caseId },
      data: { stage: next.stage, status: next.status },
    })
  }
  return { from: current, to: next, changed: next.stage !== current.stage || next.status !== current.status }
}

export async function syncLegacyCaseStateForCrmStageInTransaction(
  tx: Transaction,
  input: { caseId: string; systemKey: string | null },
  lockedState?: LockedCaseState,
) {
  const current = lockedState ?? await lockCaseTechnicalState(tx, input.caseId)
  return syncLegacyCaseStateFromCurrent(tx, input, current)
}

async function lockPipelineForMutation(tx: Transaction, pipelineId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "CrmPipeline" WHERE "id" = ${pipelineId} FOR UPDATE
  `)
}

async function lockCasePipelineForMutation(
  tx: Transaction,
  input: { caseId: string; scopeAgentIds?: string[] },
): Promise<LockedCaseCrmContext> {
  if (input.scopeAgentIds && !input.scopeAgentIds.length) {
    throw new CrmDomainError('ACCESS_DENIED', 'Caso fora da sua carteira.')
  }

  // The first read only discovers which parent pipeline must be locked. It is
  // deliberately revalidated after both locks are held, so it never authorizes
  // or mutates from stale state.
  const preview = await tx.insuranceCase.findFirst({
    where: {
      id: input.caseId,
      ...(input.scopeAgentIds
        ? { assignedAgentId: { in: input.scopeAgentIds } }
        : {}),
    },
    select: { assignedAgentId: true },
  })
  if (!preview) {
    throw new CrmDomainError('CASE_NOT_FOUND', 'Caso não encontrado ou fora da sua carteira.')
  }

  // Existing cases receive a pipeline during migration/creation. Avoid running
  // the initialization backfill before the pipeline lock: it can lock case rows
  // in the opposite order and deadlock against archive/move mutations.
  let pipeline = await tx.crmPipeline.findUnique({
    where: { agentId: preview.assignedAgentId },
    select: { id: true },
  })
  if (!pipeline) {
    // Defensive legacy fallback. With no pipeline row there is no concurrent
    // stage mutation to serialize against; the atomic upsert can safely create it.
    pipeline = await ensurePipelineInTransaction(tx, preview.assignedAgentId)
  }
  await lockPipelineForMutation(tx, pipeline.id)
  const technicalState = await lockCaseTechnicalState(tx, input.caseId)
  const insuranceCase = await tx.insuranceCase.findFirst({
    where: {
      id: input.caseId,
      assignedAgentId: preview.assignedAgentId,
      ...(input.scopeAgentIds
        ? { assignedAgentId: { in: input.scopeAgentIds } }
        : {}),
    },
    select: {
      id: true,
      assignedAgentId: true,
      crmStage: { select: { id: true, name: true, systemKey: true } },
    },
  })
  if (!insuranceCase) {
    throw new CrmDomainError(
      'CASE_NOT_FOUND',
      'O responsável pelo caso mudou em outra sessão. Atualize a página e tente novamente.',
    )
  }

  return { pipelineId: pipeline.id, insuranceCase, technicalState }
}

export async function lockCaseAndActiveCrmStageForMutation(
  tx: Transaction,
  input: {
    caseId: string
    crmStageId: string
    scopeAgentIds: string[]
    requiredSystemKey?: DefaultCrmStageKey
  },
) {
  const context = await lockCasePipelineForMutation(tx, input)
  const stage = await tx.crmStage.findFirst({
    where: {
      id: input.crmStageId,
      pipelineId: context.pipelineId,
      active: true,
      ...(input.requiredSystemKey ? { systemKey: input.requiredSystemKey } : {}),
    },
    select: { id: true, name: true, systemKey: true },
  })
  if (!stage) {
    throw new CrmDomainError(
      'STAGE_NOT_FOUND',
      'A etapa mudou ou foi removida em outra sessão. Atualize a página e tente novamente.',
    )
  }
  return { ...context, stage }
}

async function parkActiveStagePositions(
  tx: Transaction,
  stages: Array<{ id: string }>,
) {
  // The partial unique index ignores archived rows. Active positions are first
  // parked at distinct negative values so arbitrary reorderings never collide
  // with either the old or the new positive order.
  for (const [index, stage] of stages.entries()) {
    await tx.crmStage.update({ where: { id: stage.id }, data: { position: -(index + 2) } })
  }
}

function stageView(stage: {
  id: string; name: string; position: number; systemKey: string | null; active: boolean
  _count: { cases: number }
}): CrmStageView {
  return { ...stage, caseCount: stage._count.cases }
}

async function pipelineView(db: PipelineDb | Transaction, agentId: string): Promise<CrmPipelineView | null> {
  const pipeline = await db.crmPipeline.findUnique({
    where: { agentId },
    select: {
      id: true, agentId: true,
      stages: {
        where: { active: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, position: true, systemKey: true, active: true, _count: { select: { cases: true } } },
      },
    },
  })
  return pipeline ? { id: pipeline.id, agentId: pipeline.agentId, stages: pipeline.stages.map(stageView) } : null
}

async function ensurePipelineInTransaction(tx: Transaction, agentId: string) {
  // PostgreSQL compiles this to one atomic INSERT .. ON CONFLICT. A pair of
  // first requests cannot race into two pipelines for the same agent.
  const pipeline = await tx.crmPipeline.upsert({
    where: { agentId },
    update: {},
    create: { agentId },
    select: { id: true },
  })

  const stageCount = await tx.crmStage.count({ where: { pipelineId: pipeline.id } })
  if (stageCount === 0) {
    // `skipDuplicates` closes the narrow first-request race after the pipeline
    // upsert. Once customized, a non-empty pipeline is never "healed": stages
    // the user intentionally archived must stay archived.
    await tx.crmStage.createMany({
      data: DEFAULT_CRM_STAGES.map((stage, position) => ({ pipelineId: pipeline.id, ...stage, position })),
      skipDuplicates: true,
    })
  }

  const newLead = await tx.crmStage.findFirst({
    where: { pipelineId: pipeline.id, systemKey: 'NEW_LEAD', active: true }, select: { id: true },
  })
  if (!newLead) throw new CrmDomainError('STAGE_NOT_FOUND', 'A etapa inicial do CRM não está disponível.')
  await tx.insuranceCase.updateMany({ where: { assignedAgentId: agentId, crmStageId: null }, data: { crmStageId: newLead.id } })
  return pipeline
}

/// Transaction-safe primitive for case creation flows. Call this inside the
/// same Prisma transaction that creates InsuranceCase and persist its result as
/// crmStageId; a new lead never has to wait for a board read/backfill.
export async function getOrCreateNewLeadStageId(tx: Transaction, agentId: string) {
  const pipeline = await ensurePipelineInTransaction(tx, agentId)
  const stage = await tx.crmStage.findFirst({
    where: { pipelineId: pipeline.id, systemKey: 'NEW_LEAD', active: true },
    select: { id: true },
  })
  if (!stage) throw new CrmDomainError('STAGE_NOT_FOUND', 'A etapa Novo Lead não está disponível.')
  return stage.id
}

export async function ensureDefaultCrmPipeline(agentId: string, db: PipelineDb = prisma) {
  if (!agentId) throw new CrmDomainError('VALIDATION_ERROR', 'agentId é obrigatório.')
  await db.$transaction((tx) => ensurePipelineInTransaction(tx, agentId))
  return (await pipelineView(db, agentId))!
}

export async function getPipelineForAgent(agentId: string, db: PipelineDb = prisma) {
  const existing = await pipelineView(db, agentId)
  return existing?.stages.length ? existing : ensureDefaultCrmPipeline(agentId, db)
}

/**
 * Support-preview reads must never trigger the normal first-visit setup. This
 * deliberately exposes only the existing projection and returns null when no
 * local pipeline exists, without a transaction, stage creation, or case
 * backfill.
 */
export async function findPipelineForAgent(agentId: string, db: PipelineDb = prisma) {
  return pipelineView(db, agentId)
}

export async function listAgentPipelineStages(agentId: string, db: PipelineDb = prisma) {
  return (await getPipelineForAgent(agentId, db)).stages
}

export async function createCrmStage(input: { agentId: string; name: string; position?: number }, db: PipelineDb = prisma) {
  const name = input.name.trim()
  if (!name || name.length > 80) throw new CrmDomainError('VALIDATION_ERROR', 'Use um nome de etapa entre 1 e 80 caracteres.')
  return db.$transaction(async (tx) => {
    const pipeline = await ensurePipelineInTransaction(tx, input.agentId)
    await lockPipelineForMutation(tx, pipeline.id)
    const stages = await tx.crmStage.findMany({
      where: { pipelineId: pipeline.id, active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    })
    const position = Math.max(0, Math.min(input.position ?? stages.length, stages.length))
    await parkActiveStagePositions(tx, stages)
    const created = await tx.crmStage.create({
      data: { pipelineId: pipeline.id, name, position: -(stages.length + 2) },
      select: { id: true, name: true, position: true, systemKey: true, active: true },
    })
    const ordered = [...stages]
    ordered.splice(position, 0, created)
    for (const [nextPosition, stage] of ordered.entries()) {
      await tx.crmStage.update({ where: { id: stage.id }, data: { position: nextPosition } })
    }
    return { ...created, position }
  })
}

export async function renameCrmStage(input: { agentId: string; stageId: string; name: string }, db: PipelineDb = prisma) {
  const name = input.name.trim()
  if (!name || name.length > 80) throw new CrmDomainError('VALIDATION_ERROR', 'Use um nome de etapa entre 1 e 80 caracteres.')
  const result = await db.crmStage.updateMany({
    where: { id: input.stageId, pipeline: { agentId: input.agentId }, active: true }, data: { name },
  })
  if (!result.count) throw new CrmDomainError('STAGE_NOT_FOUND', 'Etapa não encontrada.')
  return db.crmStage.findUniqueOrThrow({ where: { id: input.stageId }, select: { id: true, name: true, position: true, systemKey: true, active: true } })
}

export async function reorderCrmStages(input: { agentId: string; orderedStageIds: string[] }, db: PipelineDb = prisma) {
  if (new Set(input.orderedStageIds).size !== input.orderedStageIds.length) throw new CrmDomainError('INVALID_STAGE_ORDER', 'A ordem contém etapas duplicadas.')
  await db.$transaction(async (tx) => {
    const pipeline = await tx.crmPipeline.findUnique({ where: { agentId: input.agentId }, select: { id: true } })
    if (!pipeline) throw new CrmDomainError('STAGE_NOT_FOUND', 'Pipeline não encontrado.')
    await lockPipelineForMutation(tx, pipeline.id)
    const stages = await tx.crmStage.findMany({
      where: { pipelineId: pipeline.id, active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    })
    const existing = new Set(stages.map((stage) => stage.id))
    if (existing.size !== input.orderedStageIds.length || input.orderedStageIds.some((id) => !existing.has(id))) {
      throw new CrmDomainError('INVALID_STAGE_ORDER', 'O pipeline mudou em outra sessão. Atualize a página e tente novamente.')
    }
    await parkActiveStagePositions(tx, stages)
    for (const [position, id] of input.orderedStageIds.entries()) {
      await tx.crmStage.update({ where: { id }, data: { position } })
    }
  })
  return listAgentPipelineStages(input.agentId, db)
}

export async function archiveCrmStage(input: { agentId: string; stageId: string; transferToStageId?: string }, db: PipelineDb = prisma) {
  return db.$transaction(async (tx) => {
    const pipeline = await tx.crmPipeline.findUnique({ where: { agentId: input.agentId }, select: { id: true } })
    if (!pipeline) throw new CrmDomainError('STAGE_NOT_FOUND', 'Pipeline não encontrado.')
    await lockPipelineForMutation(tx, pipeline.id)
    const source = await tx.crmStage.findFirst({
      where: { id: input.stageId, pipeline: { agentId: input.agentId }, active: true },
      select: { id: true, name: true, position: true, systemKey: true, _count: { select: { cases: true } } },
    })
    if (!source) throw new CrmDomainError('STAGE_NOT_FOUND', 'Etapa não encontrada.')
    const activeStageCount = await tx.crmStage.count({
      where: { pipeline: { agentId: input.agentId }, active: true },
    })
    if (activeStageCount <= 1) throw new CrmDomainError('VALIDATION_ERROR', 'O pipeline precisa manter ao menos uma etapa ativa.')
    let target: { id: string; name: string; systemKey: string | null } | null = null
    if (input.transferToStageId) {
      target = await tx.crmStage.findFirst({
        where: { id: input.transferToStageId, pipeline: { agentId: input.agentId }, active: true },
        select: { id: true, name: true, systemKey: true },
      })
      if (!target || target.id === source.id) throw new CrmDomainError('STAGE_NOT_FOUND', 'Escolha outra etapa ativa para receber os leads.')
    }
    if (source._count.cases && !target) {
      throw new CrmDomainError('STAGE_HAS_CASES', `Existem ${source._count.cases} leads nesta etapa. Escolha para onde movê-los. `)
    }
    // Product-owned semantics survive customization. PostgreSQL unique
    // constraints are immediate, so clear the source before assigning target.
    if (source.systemKey) {
      if (!target) throw new CrmDomainError('VALIDATION_ERROR', 'Escolha outra etapa para preservar a função desta etapa no CRM.')
      if (target.systemKey) {
        throw new CrmDomainError(
          'VALIDATION_ERROR',
          'Esta etapa de destino já possui uma função automática. Escolha uma etapa personalizada.',
        )
      }
      await tx.crmStage.update({ where: { id: source.id }, data: { systemKey: null } })
      await tx.crmStage.update({ where: { id: target.id }, data: { systemKey: source.systemKey } })
    }
    const transferredCaseIds: string[] = []
    if (target) {
      const candidates = await tx.insuranceCase.findMany({
        where: { crmStageId: source.id },
        orderBy: { id: 'asc' },
        select: { id: true },
      })
      const targetSystemKey = source.systemKey ?? target.systemKey
      for (const candidate of candidates) {
        const currentTechnicalState = await lockCaseTechnicalState(tx, candidate.id)
        const stillInSource = await tx.insuranceCase.findFirst({
          where: { id: candidate.id, crmStageId: source.id },
          select: { id: true },
        })
        if (!stillInSource) continue
        await syncLegacyCaseStateFromCurrent(
          tx,
          { caseId: candidate.id, systemKey: targetSystemKey },
          currentTechnicalState,
        )
        await tx.insuranceCase.update({
          where: { id: candidate.id },
          data: { crmStageId: target.id },
        })
        transferredCaseIds.push(candidate.id)
      }
      if (transferredCaseIds.length) {
        await tx.caseTimelineEvent.createMany({
          data: transferredCaseIds.map((caseId) => ({
            caseId,
            type: 'CRM_STAGE_CHANGED',
            title: `Lead movido para ${target.name}`,
            body: `De ${source.name} para ${target.name} porque a etapa anterior foi removida.`,
            metadata: {
              fromCrmStageId: source.id,
              toCrmStageId: target.id,
              reason: 'CRM_STAGE_ARCHIVED',
            },
          })),
        })
      }
    }
    await tx.crmStage.update({ where: { id: source.id }, data: { active: false, archivedAt: new Date(), position: -1 } })
    const remainingStages = await tx.crmStage.findMany({
      where: { pipelineId: pipeline.id, active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    })
    await parkActiveStagePositions(tx, remainingStages)
    for (const [position, stage] of remainingStages.entries()) {
      await tx.crmStage.update({ where: { id: stage.id }, data: { position } })
    }
    return { archivedStageId: source.id, transferredCases: transferredCaseIds.length, transferToStageId: target?.id ?? null }
  })
}

export type MoveCaseToCrmStageInput = { caseId: string; crmStageId: string; actorUserId: string; scopeAgentIds: string[] }

export async function advanceCaseCrmToSystemStage(
  tx: Transaction,
  input: { caseId: string; systemKey: DefaultCrmStageKey; actorUserId?: string },
) {
  // CRM mutations always lock parent pipeline first and case second. Stage
  // archive, manual movement and technical advancement therefore serialize in
  // one order and cannot publish a stale/archived stage id.
  const lockedContext = await lockCasePipelineForMutation(tx, { caseId: input.caseId })
  const locked = lockedContext.insuranceCase

  const target = await tx.crmStage.findFirst({
    where: {
      pipelineId: lockedContext.pipelineId,
      active: true,
      systemKey: input.systemKey,
    },
    select: { id: true, name: true, systemKey: true },
  })
  if (!target) throw new CrmDomainError('STAGE_NOT_FOUND', `A etapa ${input.systemKey} não está disponível neste pipeline.`)

  const currentOrder = locked.crmStage?.systemKey
    ? CRM_SYSTEM_KEY_ORDER.get(locked.crmStage.systemKey)
    : undefined
  const targetOrder = CRM_SYSTEM_KEY_ORDER.get(target.systemKey ?? '')

  // Unknown/custom stages are never overwritten by an automatic technical
  // event: the user may have deliberately placed the case beyond the standard
  // route. Terminal LOST is also durable. Known standard stages only advance.
  const canAdvance =
    locked.crmStage == null ||
    (currentOrder != null && targetOrder != null && currentOrder < targetOrder && locked.crmStage.systemKey !== 'LOST')

  const legacy = await syncLegacyCaseStateFromCurrent(
    tx,
    { caseId: locked.id, systemKey: target.systemKey },
    lockedContext.technicalState,
  )

  if (!canAdvance || locked.crmStage?.id === target.id) {
    return { caseId: locked.id, fromStage: locked.crmStage, toStage: locked.crmStage ?? target, moved: false, legacy }
  }

  await tx.insuranceCase.update({ where: { id: locked.id }, data: { crmStageId: target.id } })
  await tx.caseTimelineEvent.create({
    data: {
      caseId: locked.id,
      type: 'CRM_STAGE_CHANGED',
      title: `Lead avançou para ${target.name}`,
      body: locked.crmStage ? `De ${locked.crmStage.name} para ${target.name} por avanço técnico.` : `Etapa definida como ${target.name}.`,
      metadata: {
        fromCrmStageId: locked.crmStage?.id ?? null,
        toCrmStageId: target.id,
        actorUserId: input.actorUserId ?? null,
        reason: 'TECHNICAL_WORKFLOW_ADVANCE',
      },
    },
  })
  return { caseId: locked.id, fromStage: locked.crmStage, toStage: target, moved: true, legacy }
}

export async function moveCaseToCrmStage(input: MoveCaseToCrmStageInput, db: PipelineDb = prisma) {
  if (!input.scopeAgentIds.length) throw new CrmDomainError('ACCESS_DENIED', 'Caso fora da sua carteira.')
  return db.$transaction(async (tx) => {
    const locked = await lockCaseAndActiveCrmStageForMutation(tx, input)
    const insuranceCase = locked.insuranceCase
    const stage = locked.stage
    const legacy = await syncLegacyCaseStateFromCurrent(tx, {
      caseId: insuranceCase.id,
      systemKey: stage.systemKey,
    }, locked.technicalState)
    if (insuranceCase.crmStage?.id === stage.id) {
      return { caseId: insuranceCase.id, fromStage: insuranceCase.crmStage, toStage: stage, moved: false, legacy }
    }
    await tx.insuranceCase.update({ where: { id: insuranceCase.id }, data: { crmStageId: stage.id } })
    await tx.caseTimelineEvent.create({
      data: {
        caseId: insuranceCase.id, type: 'CRM_STAGE_CHANGED', title: `Lead movido para ${stage.name}`,
        body: insuranceCase.crmStage ? `De ${insuranceCase.crmStage.name} para ${stage.name}.` : `Etapa definida como ${stage.name}.`,
        metadata: { fromCrmStageId: insuranceCase.crmStage?.id ?? null, toCrmStageId: stage.id, actorUserId: input.actorUserId },
      },
    })
    return { caseId: insuranceCase.id, fromStage: insuranceCase.crmStage, toStage: stage, moved: true, legacy }
  })
}
