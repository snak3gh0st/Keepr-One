import { describe, expect, it } from 'vitest'
import { LAPSE_RECENCY_MS, lapseCandidatesForPass, type LapsePolicy } from './lapse-triggers'
import type { TriggerClient } from './scheduled-triggers'

const now = new Date('2026-03-11T17:00:00Z')
const phone = '+13055550142'
const client: TriggerClient = { id: 'c1', name: 'Ana', phone, dateOfBirth: null }

const policy = (over: Partial<LapsePolicy> = {}): LapsePolicy => ({
  id: 'p1', clientId: 'c1', status: 'LAPSED', sourceStatus: 'Lapsed',
  statusChangedAt: new Date('2026-03-01T00:00:00Z'), ...over,
})

const run = (policies: LapsePolicy[], clients: TriggerClient[] = [client]) =>
  lapseCandidatesForPass({ clients, policies, now })

describe('lapseCandidatesForPass', () => {
  it('raises one candidate keyed to the lapse event', () => {
    expect(run([policy()])).toEqual([{
      category: 'LAPSE_RECOVERY',
      clientId: 'c1',
      customerName: 'Ana',
      phone,
      requestKey: 'lapse:p1:2026-03-01T00:00:00.000Z',
      candidateId: 'policy:p1',
      subjectKey: 'client:c1',
      sourceHref: '/agent/policies/p1',
      timeZone: 'America/New_York',
    }])
  })

  it('uses the very id the manual list gives the same policy', () => {
    // `getFollowupCandidates` files a policy row as `policy:<id>`, and matches
    // its ALREADY_PROPOSED badge on that string. Pinned literally here because
    // a drift would not fail anything — it would quietly offer the agent the
    // same message twice, once to send by hand and once to approve.
    expect(run([policy()])[0]?.candidateId).toBe('policy:p1')
    expect(run([policy()])[0]?.subjectKey).toBe('client:c1')
  })

  it('gives a second lapse of the same policy a key of its own', () => {
    const first = run([policy()])[0]
    const second = run([policy({ statusChangedAt: new Date('2026-03-09T12:00:00Z') })])[0]
    expect(second?.candidateId).toBe(first?.candidateId)
    // Same candidate, different event: the unique index must see a new row, or
    // a client who lapsed, reinstated and lapsed again is never contacted the
    // second time.
    expect(second?.requestKey).not.toBe(first?.requestKey)
  })

  it('is stable for the same lapse across passes', () => {
    const key = () => lapseCandidatesForPass({
      clients: [client], policies: [policy()], now: new Date(now.getTime() + 86_400_000),
    })[0]?.requestKey
    expect(key()).toBe(run([policy()])[0]?.requestKey)
  })

  it('ignores a lapse older than the recency window', () => {
    const stale = new Date(now.getTime() - LAPSE_RECENCY_MS - 1000)
    expect(run([policy({ statusChangedAt: stale })])).toEqual([])
  })

  it('keeps a lapse on the last day of the window', () => {
    const edge = new Date(now.getTime() - LAPSE_RECENCY_MS + 1000)
    expect(run([policy({ statusChangedAt: edge })])).toHaveLength(1)
  })

  it('ignores a policy with no known lapse date', () => {
    // The CSV import writes null on create for a row that arrives already
    // lapsed: the day it fell out of force predates this system seeing it.
    expect(run([policy({ statusChangedAt: null })])).toEqual([])
  })

  it('ignores a status change dated in the future', () => {
    expect(run([policy({ statusChangedAt: new Date('2026-04-01T00:00:00Z') })])).toEqual([])
  })

  it('does not treat a pending lapse warning as a lapse', () => {
    // A policy still in force being warned is a different message, and it has
    // no status change to key on.
    expect(run([policy({ status: 'INFORCE', sourceStatus: 'Pending Lapse' })])).toEqual([])
  })

  it('ignores an in-force policy whose status change is recent', () => {
    expect(run([policy({ status: 'INFORCE', sourceStatus: 'Active' })])).toEqual([])
  })

  it('says nothing when there is no number to send to', () => {
    expect(run([policy()], [{ ...client, phone: null }])).toEqual([])
  })

  it('says nothing when the client is not in this agent book', () => {
    expect(run([policy({ clientId: 'other' })])).toEqual([])
  })

  it('orders candidates so a pass reads the same twice', () => {
    const rows = run([policy({ id: 'p9' }), policy({ id: 'p2' })])
    expect(rows.map((row) => row.candidateId)).toEqual(['policy:p2', 'policy:p9'])
  })
})
