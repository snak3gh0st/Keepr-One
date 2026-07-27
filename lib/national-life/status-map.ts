import type { ApplicationStatus, RequirementStatus } from '@prisma/client'

export type MappedStatus<T extends string> = {
  normalized: T
  original: string
  recognized: boolean
}

const APPLICATION_STATUS_LOOKUP: Readonly<Record<string, ApplicationStatus>> = {
  draft: 'DRAFT',
  started: 'STARTED',
  pending: 'STARTED',
  submitted: 'SUBMITTED',
  underwriting: 'UNDERWRITING',
  approved: 'APPROVED',
  issued: 'ISSUED',
  declined: 'DECLINED',
  withdrawn: 'WITHDRAWN',
}

const REQUIREMENT_STATUS_LOOKUP: Readonly<Record<string, RequirementStatus>> = {
  outstanding: 'OPEN',
  open: 'OPEN',
  pending: 'OPEN',
  received: 'RECEIVED',
  completed: 'RECEIVED',
  satisfied: 'RECEIVED',
  waived: 'WAIVED',
}

function normalizeLookupKey(value: string) {
  return value.trim().toLowerCase()
}

function mapStatus<T extends string>(
  value: string,
  lookup: Readonly<Record<string, T>>,
  fallback: T,
): MappedStatus<T> {
  const original = value.trim()
  const normalized = lookup[normalizeLookupKey(value)]

  if (normalized) {
    return {
      normalized,
      original,
      recognized: true,
    }
  }

  return {
    normalized: fallback,
    original,
    recognized: false,
  }
}

export function mapApplicationStatus(value: string): MappedStatus<ApplicationStatus> {
  return mapStatus(value, APPLICATION_STATUS_LOOKUP, 'STARTED')
}

export function mapRequirementStatus(value: string): MappedStatus<RequirementStatus> {
  return mapStatus(value, REQUIREMENT_STATUS_LOOKUP, 'OPEN')
}
