import type { Prisma } from '@prisma/client'
import type { IssueConnectorCommandInput } from './connector-command-service'
import { isSafePolicyDetailPath } from './local-connector/capabilities'

export type PolicyDetailCommandRepository = {
  findOwnedPolicy(input: { policyId: string }): Promise<{
    id: string
    agentId: string
    policyNumber: string
    carrier: string
  } | null>
  findCarrierRow(input: {
    agentId: string
    deploymentScope: string
    policyNumber: string
  }): Promise<{ raw: Prisma.JsonValue } | null>
  issue(input: IssueConnectorCommandInput & { now: Date }): Promise<{ commandId: string }>
}

const MAX_VISITED_VALUES = 256
const MAX_CARRIER_STRING = 16 * 1024

export function findNationalLifePolicyDetailPath(raw: unknown): string | null {
  const pending: unknown[] = [raw]
  let visited = 0
  while (pending.length > 0 && visited < MAX_VISITED_VALUES) {
    const value = pending.shift()
    visited += 1
    if (typeof value === 'string') {
      if (value.length > MAX_CARRIER_STRING) continue
      const trimmed = value.trim()
      if (isSafePolicyDetailPath(trimmed)) return trimmed
      const href = /\bhref\s*=\s*(["'])([^"']+)\1/gi
      for (const match of value.matchAll(href)) {
        const candidate = match[2]
        if (candidate && isSafePolicyDetailPath(candidate)) return candidate
      }
      continue
    }
    if (Array.isArray(value)) {
      pending.push(...value.slice(0, MAX_VISITED_VALUES - visited))
      continue
    }
    if (value && typeof value === 'object') {
      pending.push(...Object.values(value as Record<string, unknown>).slice(0, MAX_VISITED_VALUES - visited))
    }
  }
  return null
}

export async function requestNationalLifePolicyDetailRefresh(
  repository: PolicyDetailCommandRepository,
  input: {
    agentScopeIds: readonly string[]
    policyId: string
    deploymentScope: string
    now?: Date
  },
): Promise<{ commandId: string }> {
  const policy = await repository.findOwnedPolicy({ policyId: input.policyId })
  if (
    !policy ||
    !input.agentScopeIds.includes(policy.agentId) ||
    !/national life/i.test(policy.carrier) ||
    !policy.policyNumber
  ) throw new Error('POLICY_DETAIL_NOT_FOUND')

  const carrierRow = await repository.findCarrierRow({
    agentId: policy.agentId,
    deploymentScope: input.deploymentScope,
    policyNumber: policy.policyNumber,
  })
  const navigatePath = findNationalLifePolicyDetailPath(carrierRow?.raw)
  if (!navigatePath) throw new Error('POLICY_DETAIL_ROUTE_UNAVAILABLE')

  const now = input.now ?? new Date()
  const bucket = Math.floor(now.getTime() / (5 * 60_000))
  const issued = await repository.issue({
    agentId: policy.agentId,
    capability: 'READ_POLICY_DETAIL',
    target: {
      kind: 'POLICY',
      id: policy.id,
      carrierExternalId: policy.policyNumber,
    },
    params: { policyNumber: policy.policyNumber, navigatePath },
    idempotencyKey: `${policy.id}:policy-detail:${bucket}`,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
    now,
  })
  return { commandId: issued.commandId }
}
