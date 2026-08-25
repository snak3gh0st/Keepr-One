import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('National Life policy-detail isolation', () => {
  it('scopes every carrier report query to the policy owner agent', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
    const scopedQueries = source.match(/agentId: policy\.agentId/g) ?? []

    // Commission detail, correspondence and client intelligence all use a
    // carrier policy number that can repeat in another agent account. The local
    // policy owner is therefore part of the authority predicate, not just a UI
    // relation resolved after the query.
    expect(scopedQueries).toHaveLength(3)
  })
})
