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
    expect(findManyCalls.length).toBeGreaterThanOrEqual(2)

    // A tela de contatos não tem virtualização e um agente pode ter 17.733
    // contatos — nenhum `client.findMany` pode estar sem bound (take missing).
    // Adicionalmente, cada query vinculada a um contrato específico deve usar
    // apenas a constante que foi projetada para ele, não qualquer uma. Uma
    // refatoração que trocasse o CONTACTS_PAGE_SIZE da lista paginada para
    // ARRIVAL_EXAMPLE_CANDIDATES triplicaria o tamanho da página de 25 para 50
    // e o teste ainda passaria se aceitássemos ambas — perdendo a proteção do
    // contrato de paginação.

    // A query de contatos paginados (skip + take para página) usa CONTACTS_PAGE_SIZE
    const paginatedContactsQuery = findManyCalls.find((call) => call.includes('skip:'))
    expect(paginatedContactsQuery).toBeDefined()
    expect(paginatedContactsQuery).toContain('take: CONTACTS_PAGE_SIZE')
    expect(paginatedContactsQuery).not.toContain('ARRIVAL_EXAMPLE_CANDIDATES')

    // A query de candidatos para exemplo (sem skip, com orderBy ou select específico)
    const exampleCandidatesQuery = findManyCalls.find((call) => call.includes('dateOfBirth'))
    expect(exampleCandidatesQuery).toBeDefined()
    expect(exampleCandidatesQuery).toContain('take: ARRIVAL_EXAMPLE_CANDIDATES')

    // Todas as queries têm um bound
    for (const call of findManyCalls) {
      expect(call).toMatch(/take: /)
    }
  })
})
