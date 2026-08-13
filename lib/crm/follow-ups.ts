import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CrmDomainError } from './errors'
import {
  lockCaseAndActiveCrmStageForMutation,
  syncLegacyCaseStateForCrmStageInTransaction,
} from './pipeline'
import { formatCrmDateTime, nyDayBounds } from './time'
import type { DueFollowUpView, FollowUpMutationResult } from './types'

type FollowUpDb = Pick<PrismaClient, 'followUp' | 'insuranceCase' | 'notification' | '$transaction'>
type Transaction = Prisma.TransactionClient
type AccessInput = { actorUserId: string; scopeAgentIds: string[] }

const mutationSelect = {
  id: true, caseId: true, scheduledAt: true, status: true, completedAt: true, cancelledAt: true,
} satisfies Prisma.FollowUpSelect

function followUpResult(value: Prisma.FollowUpGetPayload<{ select: typeof mutationSelect }>): FollowUpMutationResult {
  return value
}

async function accessibleCase(tx: Transaction, caseId: string, scopeAgentIds: string[]) {
  if (!scopeAgentIds.length) throw new CrmDomainError('ACCESS_DENIED', 'Caso fora da sua carteira.')
  const insuranceCase = await tx.insuranceCase.findFirst({
    where: { id: caseId, assignedAgentId: { in: scopeAgentIds } },
    select: { id: true, assignedAgentId: true },
  })
  if (!insuranceCase) throw new CrmDomainError('CASE_NOT_FOUND', 'Caso não encontrado ou fora da sua carteira.')
  return insuranceCase
}

function validScheduledAt(scheduledAt: Date) {
  if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) {
    throw new CrmDomainError('VALIDATION_ERROR', 'Data de follow-up inválida.')
  }
}

function normalizedFollowUpTitle(value: string | undefined, fallback = 'Follow-up') {
  const title = value?.trim() || fallback
  if (title.length > 160) {
    throw new CrmDomainError('VALIDATION_ERROR', 'O título pode ter no máximo 160 caracteres.')
  }
  return title
}

export type ScheduleFollowUpInput = AccessInput & { caseId: string; scheduledAt: Date; title?: string }

async function scheduleFollowUpInTransaction(tx: Transaction, input: ScheduleFollowUpInput) {
  validScheduledAt(input.scheduledAt)
  const insuranceCase = await accessibleCase(tx, input.caseId, input.scopeAgentIds)
  const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { agent: { select: { id: true } } } })
  if (!actor?.agent || !input.scopeAgentIds.includes(actor.agent.id)) {
    throw new CrmDomainError('ACCESS_DENIED', 'Usuário não autorizado a agendar follow-up nesta carteira.')
  }
  const alreadyScheduled = await tx.followUp.findFirst({
    where: { caseId: insuranceCase.id, status: 'SCHEDULED' },
    select: { id: true, scheduledAt: true },
  })
  if (alreadyScheduled) {
    throw new CrmDomainError(
      'FOLLOW_UP_ALREADY_SCHEDULED',
      `Este lead já possui um follow-up agendado para ${formatCrmDateTime(alreadyScheduled.scheduledAt)}. Reagende o atual.`,
    )
  }
  const title = normalizedFollowUpTitle(input.title)
  const followUp = await tx.followUp.create({
    data: {
      caseId: insuranceCase.id, ownerAgentId: insuranceCase.assignedAgentId,
      createdByUserId: input.actorUserId, title, scheduledAt: input.scheduledAt,
    },
    select: mutationSelect,
  })
  const timelineEvent = await tx.caseTimelineEvent.create({
    data: {
      caseId: insuranceCase.id, type: 'FOLLOW_UP_SCHEDULED', title: 'Follow-up agendado',
      body: `${title} para ${formatCrmDateTime(input.scheduledAt)}.`,
      dueAt: input.scheduledAt,
      metadata: { followUpId: followUp.id, actorUserId: input.actorUserId, scheduledAt: input.scheduledAt.toISOString() },
    },
    select: { id: true },
  })
  const linked = await tx.followUp.update({
    where: { id: followUp.id }, data: { sourceTimelineEventId: timelineEvent.id }, select: mutationSelect,
  })
  return followUpResult(linked)
}

export async function scheduleFollowUp(input: ScheduleFollowUpInput, db: FollowUpDb = prisma) {
  try {
    return await db.$transaction((tx) => scheduleFollowUpInTransaction(tx, input))
  } catch (error) {
    if (isScheduledFollowUpUniqueViolation(error)) {
      throw new CrmDomainError('FOLLOW_UP_ALREADY_SCHEDULED', 'Este lead já possui um follow-up agendado. Reagende o atual.')
    }
    throw error
  }
}

function isScheduledFollowUpUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (String(error.meta?.target ?? '').includes('FollowUp_one_scheduled_per_case_key') ||
      String(error.meta?.target ?? '').includes('caseId'))
}

export type RescheduleFollowUpInput = AccessInput & { followUpId: string; scheduledAt: Date; title?: string }

export async function rescheduleFollowUp(input: RescheduleFollowUpInput, db: FollowUpDb = prisma) {
  validScheduledAt(input.scheduledAt)
  return db.$transaction(async (tx) => {
    const current = await tx.followUp.findFirst({
      where: { id: input.followUpId, insuranceCase: { assignedAgentId: { in: input.scopeAgentIds } } },
      select: { id: true, caseId: true, status: true, title: true, scheduledAt: true, sourceTimelineEventId: true },
    })
    if (!current) throw new CrmDomainError('FOLLOW_UP_NOT_FOUND', 'Follow-up não encontrado ou fora da sua carteira.')
    if (current.status !== 'SCHEDULED') throw new CrmDomainError('FOLLOW_UP_NOT_SCHEDULED', 'Somente follow-ups pendentes podem ser reagendados.')
    const title = normalizedFollowUpTitle(input.title, current.title)
    const resolvedAt = new Date()

    // Compare-and-swap the version observed above before creating any history.
    // scheduledAt + sourceTimelineEventId form the mutation version while the
    // follow-up is still SCHEDULED. PostgreSQL re-evaluates this predicate after
    // waiting for a concurrent row lock, so only one reschedule/resolve wins.
    const claimed = await tx.followUp.updateMany({
      where: {
        id: current.id,
        status: 'SCHEDULED',
        scheduledAt: current.scheduledAt,
        sourceTimelineEventId: current.sourceTimelineEventId,
      },
      data: { scheduledAt: input.scheduledAt, title },
    })
    if (claimed.count !== 1) {
      throw new CrmDomainError(
        'FOLLOW_UP_NOT_SCHEDULED',
        'Este follow-up foi alterado em outra sessão. Atualize a página e tente novamente.',
      )
    }

    const event = await tx.caseTimelineEvent.create({
      data: {
        caseId: current.caseId, type: 'FOLLOW_UP_RESCHEDULED', title: 'Follow-up reagendado',
        body: `De ${formatCrmDateTime(current.scheduledAt)} para ${formatCrmDateTime(input.scheduledAt)}.`, dueAt: input.scheduledAt,
        metadata: { followUpId: current.id, actorUserId: input.actorUserId, from: current.scheduledAt.toISOString(), to: input.scheduledAt.toISOString() },
      },
      select: { id: true },
    })
    const updated = await tx.followUp.update({
      where: { id: current.id },
      data: { sourceTimelineEventId: event.id },
      select: mutationSelect,
    })
    if (current.sourceTimelineEventId) {
      await tx.caseTimelineEvent.updateMany({
        where: { id: current.sourceTimelineEventId, doneAt: null }, data: { doneAt: resolvedAt },
      })
    }
    // Preserve notification history but remove stale reminders from the unread
    // badge as soon as the user chooses a new date.
    await tx.notification.updateMany({
      where: { followUpId: current.id, readAt: null }, data: { readAt: resolvedAt },
    })
    return followUpResult(updated)
  })
}

export type ResolveFollowUpInput = AccessInput & { followUpId: string; at?: Date }

export async function completeFollowUp(input: ResolveFollowUpInput, db: FollowUpDb = prisma) {
  return resolveFollowUp(input, 'COMPLETED', db)
}

export async function cancelFollowUp(input: ResolveFollowUpInput, db: FollowUpDb = prisma) {
  return resolveFollowUp(input, 'CANCELLED', db)
}

async function resolveFollowUp(input: ResolveFollowUpInput, status: 'COMPLETED' | 'CANCELLED', db: FollowUpDb) {
  const at = input.at ?? new Date()
  return db.$transaction(async (tx) => {
    const current = await tx.followUp.findFirst({
      where: { id: input.followUpId, insuranceCase: { assignedAgentId: { in: input.scopeAgentIds } } },
      select: { id: true, caseId: true, status: true, scheduledAt: true, sourceTimelineEventId: true },
    })
    if (!current) throw new CrmDomainError('FOLLOW_UP_NOT_FOUND', 'Follow-up não encontrado ou fora da sua carteira.')
    if (current.status === status) return followUpResult(await tx.followUp.findUniqueOrThrow({ where: { id: current.id }, select: mutationSelect }))
    if (current.status !== 'SCHEDULED') throw new CrmDomainError('FOLLOW_UP_NOT_SCHEDULED', 'Este follow-up já foi finalizado.')
    const claimed = await tx.followUp.updateMany({
      where: {
        id: current.id,
        status: 'SCHEDULED',
        scheduledAt: current.scheduledAt,
        sourceTimelineEventId: current.sourceTimelineEventId,
      },
      data: status === 'COMPLETED' ? { status, completedAt: at } : { status, cancelledAt: at },
    })
    if (claimed.count !== 1) {
      const winner = await tx.followUp.findUniqueOrThrow({ where: { id: current.id }, select: mutationSelect })
      if (winner.status === status) return followUpResult(winner)
      throw new CrmDomainError(
        'FOLLOW_UP_NOT_SCHEDULED',
        winner.status === 'SCHEDULED'
          ? 'Este follow-up foi alterado em outra sessão. Atualize a página e tente novamente.'
          : 'Este follow-up já foi finalizado.',
      )
    }
    await tx.notification.updateMany({
      where: { followUpId: current.id, readAt: null }, data: { readAt: at },
    })
    if (current.sourceTimelineEventId) {
      await tx.caseTimelineEvent.updateMany({
        where: { id: current.sourceTimelineEventId, doneAt: null }, data: { doneAt: at },
      })
    }
    await tx.caseTimelineEvent.create({
      data: {
        caseId: current.caseId, type: status === 'COMPLETED' ? 'FOLLOW_UP_COMPLETED' : 'FOLLOW_UP_CANCELLED',
        title: status === 'COMPLETED' ? 'Follow-up realizado' : 'Follow-up cancelado', doneAt: at,
        metadata: { followUpId: current.id, actorUserId: input.actorUserId },
      },
    })
    return followUpResult(await tx.followUp.findUniqueOrThrow({ where: { id: current.id }, select: mutationSelect }))
  })
}

export type MoveCaseAndScheduleFollowUpInput = ScheduleFollowUpInput & { crmStageId: string }

export async function moveCaseAndScheduleFollowUp(input: MoveCaseAndScheduleFollowUpInput, db: FollowUpDb = prisma) {
  try {
    return await db.$transaction(async (tx) => {
    const locked = await lockCaseAndActiveCrmStageForMutation(tx, {
      caseId: input.caseId,
      crmStageId: input.crmStageId,
      scopeAgentIds: input.scopeAgentIds,
      requiredSystemKey: 'FOLLOW_UP',
    })
    const insuranceCase = locked.insuranceCase
    const stage = locked.stage
    await syncLegacyCaseStateForCrmStageInTransaction(tx, {
      caseId: insuranceCase.id,
      systemKey: 'FOLLOW_UP',
    }, locked.technicalState)
    const previous = await tx.insuranceCase.findUnique({ where: { id: insuranceCase.id }, select: { crmStage: { select: { id: true, name: true } } } })
    await tx.insuranceCase.update({ where: { id: insuranceCase.id }, data: { crmStageId: stage.id } })
    if (previous?.crmStage?.id !== stage.id) {
      await tx.caseTimelineEvent.create({
        data: {
          caseId: insuranceCase.id, type: 'CRM_STAGE_CHANGED', title: `Lead movido para ${stage.name}`,
          body: previous?.crmStage ? `De ${previous.crmStage.name} para ${stage.name}.` : `Etapa definida como ${stage.name}.`,
          metadata: { fromCrmStageId: previous?.crmStage?.id ?? null, toCrmStageId: stage.id, actorUserId: input.actorUserId },
        },
      })
    }
    const followUp = await scheduleFollowUpInTransaction(tx, input)
    return { caseId: insuranceCase.id, crmStage: stage, followUp }
    })
  } catch (error) {
    if (isScheduledFollowUpUniqueViolation(error)) {
      throw new CrmDomainError('FOLLOW_UP_ALREADY_SCHEDULED', 'Este lead já possui um follow-up agendado. Reagende o atual.')
    }
    throw error
  }
}

export async function getOpenFollowUpsForCase(
  caseId: string,
  scopeAgentIds: string[],
  db: FollowUpDb = prisma,
) {
  if (!scopeAgentIds.length) return []
  return db.followUp.findMany({
    where: {
      caseId,
      status: 'SCHEDULED',
      insuranceCase: { assignedAgentId: { in: scopeAgentIds } },
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    select: mutationSelect,
  })
}

function calendarDayDifference(from: Date, to: Date) {
  const a = nyDayBounds(from).start.getTime()
  const b = nyDayBounds(to).start.getTime()
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

async function queryOpenFollowUps(
  scopeAgentIds: string[], now: Date, db: FollowUpDb,
  scheduledAt?: Prisma.DateTimeFilter,
): Promise<DueFollowUpView[]> {
  if (!scopeAgentIds.length) return []
  const { start } = nyDayBounds(now)
  const rows = await db.followUp.findMany({
    where: { ownerAgentId: { in: scopeAgentIds }, status: 'SCHEDULED', ...(scheduledAt ? { scheduledAt } : {}) },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, caseId: true, ownerAgentId: true, title: true, scheduledAt: true,
      insuranceCase: {
        select: {
          prospect: { select: { firstName: true, lastName: true, phone: true, email: true } },
          crmStage: { select: { id: true, name: true, systemKey: true } },
          timelineEvents: { orderBy: { createdAt: 'desc' }, take: 1, select: { title: true, createdAt: true } },
        },
      },
    },
  })
  return rows.map((row) => {
    const overdue = row.scheduledAt < start
    return {
      id: row.id, caseId: row.caseId, ownerAgentId: row.ownerAgentId, title: row.title,
      scheduledAt: row.scheduledAt, overdue, overdueDays: overdue ? calendarDayDifference(row.scheduledAt, now) : 0,
      prospect: {
        name: `${row.insuranceCase.prospect.firstName} ${row.insuranceCase.prospect.lastName}`.trim(),
        phone: row.insuranceCase.prospect.phone, email: row.insuranceCase.prospect.email,
      },
      stage: row.insuranceCase.crmStage,
      lastInteraction: row.insuranceCase.timelineEvents[0] ?? null,
      href: `/agent/cases/${row.caseId}`,
    }
  })
}

export async function getOpenFollowUpsForScope(
  scopeAgentIds: string[], now = new Date(), db: FollowUpDb = prisma,
) {
  return queryOpenFollowUps(scopeAgentIds, now, db)
}

export async function getDueFollowUpsForScope(
  scopeAgentIds: string[], now = new Date(), db: FollowUpDb = prisma,
) {
  return queryOpenFollowUps(scopeAgentIds, now, db, { lt: nyDayBounds(now).end })
}

export async function generateDueFollowUpNotifications(now = new Date(), db: FollowUpDb = prisma) {
  return db.$transaction(async (tx) => {
    const { start } = nyDayBounds(now)

    // Lock every due row before reading its schedule and creating the reminder.
    // A concurrent reschedule/complete/cancel either waits and then marks this
    // notification read, or wins first and makes this SELECT skip the row. The
    // scheduler therefore cannot publish an unread reminder for a stale version.
    // SKIP LOCKED also lets multiple app instances run this pass safely.
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT follow_up."id"
      FROM "FollowUp" AS follow_up
      WHERE follow_up."status" = 'SCHEDULED'::"FollowUpStatus"
        AND follow_up."scheduledAt" <= ${now}
      ORDER BY follow_up."scheduledAt" ASC, follow_up."createdAt" ASC
      FOR UPDATE OF follow_up SKIP LOCKED
    `)
    const lockedIds = locked.map((row) => row.id)
    if (!lockedIds.length) return { examined: 0, created: 0 }

    const due = await tx.followUp.findMany({
      // Revalidate while holding the row lock. This also keeps the contract
      // explicit if a future query changes how candidates are acquired.
      where: { id: { in: lockedIds }, status: 'SCHEDULED', scheduledAt: { lte: now } },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, caseId: true, scheduledAt: true,
        ownerAgent: { select: { userId: true } },
        insuranceCase: { select: { prospect: { select: { firstName: true, lastName: true } } } },
      },
    })
    if (!due.length) return { examined: 0, created: 0 }

    const data: Prisma.NotificationCreateManyInput[] = due.map((followUp) => {
      const name = `${followUp.insuranceCase.prospect.firstName} ${followUp.insuranceCase.prospect.lastName}`.trim()
      return {
        recipientUserId: followUp.ownerAgent.userId, followUpId: followUp.id, caseId: followUp.caseId,
        type: 'FOLLOW_UP_DUE', title: followUp.scheduledAt < start ? 'Follow-up pendente' : 'Follow-up de hoje',
        message: `Faça o follow-up com ${name}.`, href: `/agent/cases/${followUp.caseId}`,
        dedupeKey: `follow-up-due:${followUp.id}:${followUp.scheduledAt.toISOString()}`,
      }
    })
    const result = await tx.notification.createMany({ data, skipDuplicates: true })
    return { examined: due.length, created: result.count }
  })
}
