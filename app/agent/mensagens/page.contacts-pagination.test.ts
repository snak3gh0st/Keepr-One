import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `KBotContactList` (Task 3) has no virtualisation, and an agent can have
// 17.733 contacts. This test exists so nobody can quietly widen or drop the
// `take` on the contact query in a later refactor and have the page try to
// render every row at once — it pins both the constant's name (so the
// assertion tracks a rename) and its value.
describe('mensagens contact list stays paginated', () => {
  it('bounds the contact query with an explicit take of CONTACTS_PAGE_SIZE', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

    const constant = source.match(/const CONTACTS_PAGE_SIZE = (\d+)/)
    expect(constant).not.toBeNull()
    expect(Number(constant![1])).toBe(25)

    const boundedQueries = source.match(/take: CONTACTS_PAGE_SIZE/g) ?? []
    expect(boundedQueries.length).toBeGreaterThanOrEqual(1)
  })
})
