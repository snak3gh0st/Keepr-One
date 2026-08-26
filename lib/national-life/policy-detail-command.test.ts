import { describe, expect, it, vi } from 'vitest'
import {
  findNationalLifePolicyDetailPath,
  requestNationalLifePolicyDetailRefresh,
  type PolicyDetailCommandRepository,
} from './policy-detail-command'

const path = `/agent/book-of-business/inforce-book/all-clients/policy-details?id=${'a'.repeat(32)}`

describe('National Life policy detail command', () => {
  it('extracts only the exact policy detail link from the carrier row', () => {
    expect(findNationalLifePolicyDetailPath({
      PolicyNumber: `<a href="${path}">LS1473219</a>`,
      OtherLink: 'https://evil.example/agent/x',
    })).toBe(path)
    expect(findNationalLifePolicyDetailPath({ PolicyNumber: `${path}&next=/agent/x` })).toBeNull()
  })

  it('issues one short-lived read command scoped to the policy owner', async () => {
    const repository = {
      findOwnedPolicy: vi.fn(async () => ({
        id: 'policy_1', agentId: 'agent_1', policyNumber: 'LS1473219', carrier: 'National Life',
      })),
      findCarrierRow: vi.fn(async () => ({ raw: { PolicyNumber: `<a href="${path}">LS1473219</a>` } })),
      issue: vi.fn(async () => ({ commandId: 'cmd_1' })),
    } satisfies PolicyDetailCommandRepository
    const now = new Date('2026-08-26T17:00:00.000Z')

    await expect(requestNationalLifePolicyDetailRefresh(repository, {
      agentScopeIds: ['agent_1'], policyId: 'policy_1', deploymentScope: 'scope_1', now,
    })).resolves.toEqual({ commandId: 'cmd_1' })
    expect(repository.issue).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent_1',
      capability: 'READ_POLICY_DETAIL',
      target: { kind: 'POLICY', id: 'policy_1', carrierExternalId: 'LS1473219' },
      params: { policyNumber: 'LS1473219', navigatePath: path },
      expiresAt: new Date('2026-08-26T17:15:00.000Z'),
    }))
  })

  it('refuses a policy outside scope or without a carrier detail link', async () => {
    const repository = {
      findOwnedPolicy: vi.fn(async () => ({
        id: 'policy_1', agentId: 'agent_2', policyNumber: 'LS1473219', carrier: 'National Life',
      })),
      findCarrierRow: vi.fn(async () => null),
      issue: vi.fn(async () => ({ commandId: 'cmd_1' })),
    } satisfies PolicyDetailCommandRepository

    await expect(requestNationalLifePolicyDetailRefresh(repository, {
      agentScopeIds: ['agent_1'], policyId: 'policy_1', deploymentScope: 'scope_1',
    })).rejects.toThrow('POLICY_DETAIL_NOT_FOUND')
    expect(repository.issue).not.toHaveBeenCalled()
  })
})
