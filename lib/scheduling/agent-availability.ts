import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { dateKeyInTimeZone } from '@/lib/calendar/time'
import {
  SCHEDULING_DEFAULT_PUBLIC_RANGE_DAYS,
  SCHEDULING_MAX_AGENT_SLOTS,
} from './constants'
import { getPublicSchedulingAvailability, type PublicSchedulingSlot } from './availability'
import { SchedulingError } from './errors'

type AgentAvailabilityDb = Pick<PrismaClient, 'agent' | 'schedulingPage' | 'schedulingBooking'>

type AgentAvailabilityDependencies = Parameters<typeof getPublicSchedulingAvailability>[1] & {
  db?: AgentAvailabilityDb
}

export type AgentSchedulingUnavailableReason =
  /** No Agent row for this id — the caller passed something that is not an agent. */
  | 'AGENT_NOT_FOUND'
  /** The common case today: the agent never configured a scheduling page. */
  | 'NO_SCHEDULING_PAGE'
  /** The page exists but is off, or the agent account is not ACTIVE. */
  | 'SCHEDULING_PAGE_DISABLED'
  /** The Google connection cannot confirm conflicts, so no slot may be offered. */
  | 'SCHEDULING_UNAVAILABLE'

/**
 * Discriminated on `available` so the failure branch carries no `slots` field at
 * all: it is type-impossible to hand the K-BOT times that were produced without
 * a usable calendar. Weekly windows are never a fallback — an agenda we cannot
 * confirm against Google is an agenda with no offers.
 */
export type AgentSchedulingAvailability =
  | { available: false; reason: AgentSchedulingUnavailableReason }
  | {
    available: true
    slug: string
    page: Awaited<ReturnType<typeof getPublicSchedulingAvailability>>['page']
    slots: PublicSchedulingSlot[]
  }

type AgentAvailabilityInput = {
  agentId: string
  /** Viewer timezone for the returned range; defaults to the host's own zone. */
  viewerTimeZone?: string
  /** Days of host availability to scan; the same public ceiling applies. */
  days?: number
  /** Upper bound on the returned slots, capped by SCHEDULING_MAX_AGENT_SLOTS. */
  limit?: number
  now?: Date
}

function unavailableReason(error: SchedulingError): AgentSchedulingUnavailableReason | null {
  // `getPublicSchedulingPage` folds "disabled page" and "inactive agent" into a
  // single PAGE_NOT_FOUND branch; both mean the same thing to the K-BOT.
  if (error.code === 'PAGE_NOT_FOUND') return 'SCHEDULING_PAGE_DISABLED'
  // A malformed range is a caller bug, not an agenda answer. Reporting it as
  // "calendar unavailable" would teach the K-BOT to blame the integration.
  if (error.code === 'INVALID_REQUEST') return null
  return 'SCHEDULING_UNAVAILABLE'
}

/**
 * Entry point for callers that know the agent but not the public slug — the
 * K-BOT offering times inside a WhatsApp conversation. Resolution is the unique
 * chain Agent.userId -> SchedulingPage.ownerUserId -> slug; every availability
 * rule (windows, buffers, notice, advance, host/viewer zones, Google busy) stays
 * in `getPublicSchedulingAvailability`, which this only delegates to.
 *
 * This module resolves and delegates. Authorization is the caller's job: the
 * public surface is keyed by slug on purpose, so any agentId-keyed route must
 * scope the requested agent to the signed-in caller before calling here.
 */
export async function getNextSchedulingSlotsForAgent(
  input: AgentAvailabilityInput,
  dependencies: AgentAvailabilityDependencies = {},
): Promise<AgentSchedulingAvailability> {
  const db = dependencies.db ?? prisma
  const now = dependencies.now ?? new Date()
  const requestedLimit = Math.trunc(input.limit ?? SCHEDULING_MAX_AGENT_SLOTS)
  // A non-finite limit would slice to an empty list and read as "fully booked".
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), SCHEDULING_MAX_AGENT_SLOTS)
    : SCHEDULING_MAX_AGENT_SLOTS

  const agent = await db.agent.findUnique({
    where: { id: input.agentId },
    select: {
      user: {
        select: {
          timeZone: true,
          schedulingPage: { select: { slug: true } },
        },
      },
    },
  })
  if (!agent) return { available: false, reason: 'AGENT_NOT_FOUND' }
  if (!agent.user.schedulingPage) return { available: false, reason: 'NO_SCHEDULING_PAGE' }

  const viewerTimeZone = input.viewerTimeZone ?? agent.user.timeZone
  try {
    const availability = await getPublicSchedulingAvailability(
      {
        slug: agent.user.schedulingPage.slug,
        from: dateKeyInTimeZone(now, viewerTimeZone),
        days: input.days ?? SCHEDULING_DEFAULT_PUBLIC_RANGE_DAYS,
        viewerTimeZone,
      },
      { ...dependencies, db, now },
    )
    return {
      available: true,
      slug: agent.user.schedulingPage.slug,
      page: availability.page,
      slots: availability.slots.slice(0, limit),
    }
  } catch (error) {
    // Only the scheduling domain's own refusals become a handled reason. An
    // unexpected failure keeps propagating instead of being flattened into a
    // reassuring "no times available".
    const reason = error instanceof SchedulingError ? unavailableReason(error) : null
    if (reason) return { available: false, reason }
    throw error
  }
}
