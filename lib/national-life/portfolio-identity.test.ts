import { describe, expect, it } from 'vitest'
import { matchClient, normalizeClientName, type ClientCandidate } from './portfolio-identity'

const dob = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

describe('normalizeClientName', () => {
  it('ignores case, padding and doubled spaces so the carrier and the app agree', () => {
    expect(normalizeClientName('  ENRICO   ABDALLA ')).toBe('enrico abdalla')
  })
})

describe('matchClient', () => {
  it('matches an existing client on name and date of birth', () => {
    const existing: ClientCandidate[] = [{ id: 'c1', name: 'Enrico Abdalla', dateOfBirth: dob(1980, 1, 15) }]
    const match = matchClient({ id: null, name: 'ENRICO ABDALLA', dateOfBirth: dob(1980, 1, 15) }, existing)

    expect(match).toEqual({ kind: 'MATCHED', clientId: 'c1' })
  })

  it('keeps two people who share a name but not a date of birth apart', () => {
    const existing: ClientCandidate[] = [{ id: 'c1', name: 'Maria Silva', dateOfBirth: dob(1980, 1, 15) }]
    const match = matchClient({ id: null, name: 'Maria Silva', dateOfBirth: dob(1991, 7, 2) }, existing)

    expect(match).toEqual({ kind: 'CREATE' })
  })

  it('matches on name alone when no date of birth is known, and says it is unsure', () => {
    const existing: ClientCandidate[] = [{ id: 'c1', name: 'Maria Silva', dateOfBirth: null }]
    const match = matchClient({ id: null, name: 'Maria Silva', dateOfBirth: null }, existing)

    expect(match).toEqual({ kind: 'MATCHED_LOW_CONFIDENCE', clientId: 'c1' })
  })

  it('refuses to attach a client with no date of birth to one that has a different one', () => {
    const existing: ClientCandidate[] = [{ id: 'c1', name: 'Maria Silva', dateOfBirth: dob(1980, 1, 15) }]
    const match = matchClient({ id: null, name: 'Maria Silva', dateOfBirth: null }, existing)

    expect(match).toEqual({ kind: 'CREATE' })
  })

  it('refuses to guess when two undated namesakes already exist', () => {
    const existing: ClientCandidate[] = [
      { id: 'c1', name: 'Maria Silva', dateOfBirth: null },
      { id: 'c2', name: 'Maria Silva', dateOfBirth: null },
    ]
    const match = matchClient({ id: null, name: 'Maria Silva', dateOfBirth: null }, existing)

    expect(match).toEqual({ kind: 'CREATE' })
  })

  it('creates when nothing matches', () => {
    expect(matchClient({ id: null, name: 'Ada Lovelace', dateOfBirth: null }, [])).toEqual({ kind: 'CREATE' })
  })
})
