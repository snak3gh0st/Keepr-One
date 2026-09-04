import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importCommissions, importPolicies } from './import-service'

const db = vi.hoisted(() => ({ ledger: new Map<string, any>(), aggregates: new Map<string, number>(), status: '', fail: false, failOverride: false, clients: 0 }))
vi.mock('@/lib/prisma', () => {
  const api: any = {
    importBatch: { create: async () => { db.status = 'PROCESSING'; return { id: 'batch' } }, update: async ({ data }: any) => { db.status = data.status } },
    agent: { findMany: async () => [{ id: 'a', parentAgentId: 'boss', rank: 'AGENT' }, { id: 'boss', parentAgentId: null, rank: 'LEADER' }], findUnique: async () => ({ id: 'a' }) },
    commissionPlan: { findMany: async () => [{ rank: 'LEADER', downlineLevel: 1, overridePercent: 10 }] },
    policy: { findUnique: async () => ({ id: 'p' }), upsert: async () => { throw new Error('secret database details') } },
    client: { upsert: async () => { db.clients++; return { id: 'c' } } },
    commissionTransaction: {
      findUnique: async ({ where }: any) => db.ledger.get(JSON.stringify(where)),
      upsert: async ({ where, create, update }: any) => { const key = JSON.stringify(where); db.ledger.set(key, db.ledger.has(key) ? { ...db.ledger.get(key), ...update } : create) },
    },
    commissionRecord: { upsert: async ({ where, create, update }: any) => {
      if (db.fail || (db.failOverride && create.type === 'OVERRIDE')) { db.failOverride = false; throw new Error('secret database details') }
      const key = JSON.stringify(where)
      db.aggregates.set(key, db.aggregates.has(key) ? (typeof update.amount === 'number' ? update.amount : db.aggregates.get(key)! + update.amount.increment) : create.amount)
    } },
  }
  api.$transaction = async (fn: any) => {
    const ledger = new Map(db.ledger), aggregates = new Map(db.aggregates), clients = db.clients
    try { return await fn(api) } catch (error) { db.ledger = ledger; db.aggregates = aggregates; db.clients = clients; throw error }
  }
  return { prisma: api }
})
const csv = (...rows: string[]) => 'policyNumber,agentNpn,amount,period,transactionType,sourceTransactionId\n' + rows.join('\n')
const payment = (amount: number, id = '', type = 'PAID') => `P,123,${amount},2026-09,${type},${id}`
const total = (type = 'DIRECT') => [...db.aggregates].filter(([key]) => key.includes(`"type":"${type}"`)).reduce((sum, [, amount]) => sum + amount, 0)
beforeEach(() => { db.ledger.clear(); db.aggregates.clear(); db.status = ''; db.fail = false; db.failOverride = false; db.clients = 0 })
describe('atomic commission imports', () => {
  it('aggregates 100 + 50 and deduplicates renamed/reordered contents', async () => {
    await importCommissions(csv(payment(100), payment(50)), 'u', 'first.csv')
    expect(total()).toBe(150)
    expect([...db.ledger.values()].reduce((sum, row) => sum + row.amount, 0)).toBe(150)
    await importCommissions(csv(payment(50), payment(100)), 'u', 'renamed.csv')
    expect(total()).toBe(150); expect(total('OVERRIDE')).toBe(15); expect(db.ledger.size).toBe(2)
  })
  it('retains identical no-ID payments as two entries and warns that corrections require IDs', async () => {
    const result = await importCommissions(csv(payment(100), payment(100)), 'u', 'first.csv')
    expect(total()).toBe(200); expect(db.ledger.size).toBe(2)
    expect(result.warnings?.join(' ')).toMatch(/sem.*ID/i)
    await importCommissions(csv(payment(100), payment(100)), 'u', 'retry.csv')
    expect(total()).toBe(200)
    await importCommissions(csv(payment(150)), 'u', 'changed.csv')
    expect(total()).toBe(350)
  })
  it('explicit retry has zero delta and corrections use signed financial effects', async () => {
    await importCommissions(csv(payment(100, 'ID')), 'u', 'a.csv')
    await importCommissions(csv(payment(100, 'ID')), 'u', 'b.csv')
    expect(total()).toBe(100)
    await importCommissions(csv(payment(50, 'ID')), 'u', 'b.csv')
    expect(total()).toBe(50)
    await importCommissions(csv(payment(20, 'ID', 'CHARGEBACK')), 'u', 'b.csv')
    expect(total()).toBe(-20); expect(total('OVERRIDE')).toBe(-2)
    await importCommissions(csv(payment(500, 'ID', 'EXPECTED')), 'u', 'b.csv')
    expect(total()).toBe(0)
    await importCommissions(csv(payment(-10, 'ID', 'ADJUSTMENT')), 'u', 'b.csv')
    expect(total()).toBe(-10); expect(total('OVERRIDE')).toBe(-1)
  })
  it('rolls back a failed row and records a non-sensitive terminal failure', async () => {
    db.fail = true
    const result = await importCommissions(csv(payment(100)), 'u', 'a.csv')
    expect(db.ledger.size).toBe(0); expect(db.aggregates.size).toBe(0)
    expect(db.status).toBe('FAILED'); expect(result.errors[0].message).not.toContain('secret')
  })
  it('rolls back client creation when a policy row fails', async () => {
    const result = await importPolicies('clientName,agentNpn,carrier,product,policyNumber,faceAmount,premium,status\nTest,123,Carrier,Term,P,1000,10,PENDING', 'u', 'p.csv')
    expect(db.clients).toBe(0); expect(result.status).toBe('FAILED'); expect(db.status).toBe('FAILED')
  })
})

it('rolls back ledger and direct aggregate when an override fails, then continues other rows', async () => {
  db.failOverride = true
  const result = await importCommissions(csv(payment(100), payment(50)), 'u', 'a.csv')
  expect(result.status).toBe('COMPLETED_WITH_ERRORS'); expect(db.status).toBe('COMPLETED_WITH_ERRORS')
  expect(result.successCount).toBe(1); expect(result.errors[0].row).toBe(2)
  expect(db.ledger.size).toBe(1); expect(total()).toBe(50); expect(total('OVERRIDE')).toBe(5)
})
it('normalizes financial content and validates before database writes', async () => {
  await importCommissions(csv(payment(100)), 'u', 'a.csv')
  await importCommissions(csv('P,123,100.00,2026-09,PAID,'), 'u', 'b.csv')
  expect(db.ledger.size).toBe(1); expect(total()).toBe(100)
  const result = await importCommissions(csv('P,123,100,2026-13,PAID,'), 'u', 'bad.csv')
  expect(result.status).toBe('FAILED'); expect(db.ledger.size).toBe(1)
})
