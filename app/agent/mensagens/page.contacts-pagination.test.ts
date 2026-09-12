import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `KBotContactList` (Task 3) has no virtualisation, and an agent can have
// 17.733 contacts. `KBotContactList` cannot survive rendering all of them at
// once, so the query that feeds it must always carry an explicit `take` — a
// refactor that widens or drops it would not fail loudly on its own, it
// would just make the page slow, then unusable. This test pins both the
// constant's name (so it tracks a rename) and its value, and — unlike
// matching `take: CONTACTS_PAGE_SIZE` anywhere in the file — ties the
// assertion to the `client.findMany` call itself, so it cannot pass because
// an unrelated query happens to carry the same `take` while the contacts
// query grew unbounded, or because a second, unbounded `client.findMany`
// was added alongside it.
describe('mensagens contact list stays paginated', () => {
  it('bounds the client.findMany call feeding the contact list', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

    const constant = source.match(/const CONTACTS_PAGE_SIZE = (\d+)/)
    expect(constant).not.toBeNull()
    expect(Number(constant![1])).toBe(25)

    // Every `client.findMany(...)` call block, matched non-greedily up to its
    // closing `})` at the same call depth this codebase's formatting uses.
    const findManyCalls = source.match(/client\.findMany\(\{[\s\S]*?\n {4}\}\)/g) ?? []
    expect(findManyCalls.length).toBeGreaterThanOrEqual(1)

    // No `client.findMany` anywhere in the file may skip the bound — one
    // unbounded contacts query is exactly the failure this test exists to
    // catch. Each query must use either CONTACTS_PAGE_SIZE or another
    // explicitly named constant (e.g. ARRIVAL_EXAMPLE_CANDIDATES).
    for (const call of findManyCalls) {
      expect(call).toMatch(/take: (CONTACTS_PAGE_SIZE|ARRIVAL_EXAMPLE_CANDIDATES)/)
    }
  })
})
