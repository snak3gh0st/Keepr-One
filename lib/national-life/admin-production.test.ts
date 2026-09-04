import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { buildAdminProduction, loadAdminProduction } from './admin-production'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './local-connector/config'
const agents = [{ id: 'writer', npn: '123', name: 'Writer' }, { id: 'owner', npn: '999', name: 'Owner' }]
const carrier = (patch: Record<string, unknown> = {}, owner = 'owner', scope: string = LOCAL_CONNECTOR_DEPLOYMENT_SCOPE) => ({
  id: `${owner}-${JSON.stringify(patch)}`, agentId: owner, deploymentScope: scope, gridKey: 'COMMISSIONS_EARNING_REPORT', amounts: {},
  raw: { CommissionStatementId: 'S', PolicyNumber: 'P', PaymentDate: '09/01/2026', WritingAgtLevel: 'Personal', WritingAgtNumber: '123', GrossCommEarned: '100', ...patch },
})
const base = { agents, policies: [], legacy: [], period: '2026-09' }
describe('global administrative production', () => {
  it('maps direct writing NPN, collapses global duplicate earnings, excludes overrides and legacy money', () => {
    const result = buildAdminProduction({ ...base, carrierRows: [carrier(), carrier({ CommissionStatementId: 'ROTATED' }, 'writer'), carrier({ WritingAgtLevel: 'Override' })], legacy: [{ agentId: 'writer', period: '2026-09', amount: 800, type: 'DIRECT' }] })
    expect(result.rows.find((row) => row.agentId === 'writer')?.commissionTotal).toBe(100)
    expect(result.rows.find((row) => row.agentId === 'owner')?.commissionTotal).toBe(0)
    expect(result.coverage.globalDuplicates).toBe(1)
    expect(result.coverage.ignoredOverrides).toBe(1)
    expect(result.source).toBe('NATIONAL_LIFE')
  })
  it('discloses unknown NPN and policies without effective date instead of guessing', () => {
    const result = buildAdminProduction({ ...base, carrierRows: [carrier({ WritingAgtNumber: 'unknown' })], policies: [{ agentId: 'writer', premium: 500, effectiveDate: null }] })
    expect(result.coverage.unmappedDirectRows).toBe(1); expect(result.coverage.unmappedDirectAmount).toBe(100)
    expect(result.coverage.policiesWithoutEffectiveDate).toBe(1)
    expect(result.rows.every((row) => row.commissionTotal === 0 && row.policyCount === 0)).toBe(true)
  })
  it('excludes non-earning grids and canonicalizes retired source months', () => {
    const result = buildAdminProduction({ ...base, carrierRows: [carrier(), carrier({ GrossCommEarned: '800' }, 'owner', 'keepr-one-production-v1'), { ...carrier({ GrossCommEarned: '500' }), gridKey: 'UNRELATED' }] })
    expect(result.rows.find((row) => row.agentId === 'writer')?.commissionTotal).toBe(100)
  })
  it('uses UTC effective date boundaries, never insertion dates', () => {
    const result = buildAdminProduction({ ...base, carrierRows: [], policies: [
      { agentId: 'writer', premium: 100, effectiveDate: new Date('2026-09-01T00:00:00Z') },
      { agentId: 'writer', premium: 500, effectiveDate: new Date('2026-10-01T00:00:00Z') },
      { agentId: 'writer', premium: 1000, effectiveDate: new Date('2026-08-31T23:59:59Z') },
    ] })
    expect(result.rows.find((row) => row.agentId === 'writer')).toMatchObject({ policyCount: 1, premiumTotal: 100 })
  })
  it('discloses legacy-only fallback and filters out its overrides', () => {
    const result = buildAdminProduction({ ...base, carrierRows: [], legacy: [{ agentId: 'writer', period: '2026-09', amount: 80, type: 'DIRECT' }, { agentId: 'writer', period: '2026-09', amount: 20, type: 'OVERRIDE' }] })
    expect(result.source).toBe('LEGACY'); expect(result.rows[0].commissionTotal).toBe(80)
  })
  it('does not query manual commissions when carrier evidence exists', async () => {
    const legacy = vi.fn()
    const prisma = { agent: { findMany: async () => agents.map((a) => ({ ...a, user: { name: a.name } })) }, policy: { findMany: async () => [] }, nationalLifeReportRow: { findMany: async () => [carrier()] }, commissionRecord: { findMany: legacy } } as unknown as PrismaClient
    const result = await loadAdminProduction(prisma, '2026-09')
    expect(legacy).not.toHaveBeenCalled(); expect(result.rows[0].commissionTotal).toBe(100)
  })
})

it('discloses specifically missing carrier NPN and payment dates', () => {
  const result = buildAdminProduction({ ...base, carrierRows: [carrier({ WritingAgtNumber: '' }), carrier({ PaymentDate: '' })] })
  expect(result.coverage.missingWritingAgentRows).toBe(1)
  expect(result.coverage.missingPaymentDateRows).toBe(1)
  expect(result.source).toBe('NATIONAL_LIFE')
})
