import { describe, expect, it } from 'vitest'
import {
  classifyLanding,
  hopPaths,
  shiftedExpiries,
  summarizeCookies,
} from './national-life-probe-foresight-session'

const at = (iso: string) => new Date(iso).getTime() / 1000

describe('summarizeCookies', () => {
  it('reports domain, name and expiry, never the value', () => {
    const summary = summarizeCookies({
      cookies: [
        { name: 'auth0', domain: 'nlg-prod.auth0.com', value: 'secret', expires: at('2026-07-31T03:10:00Z') },
        { name: 'ASP.NET_SessionId', domain: '.nationallife.com', value: 'secret' },
      ],
    })

    expect(summary).toEqual([
      { key: '.nationallife.com|ASP.NET_SessionId', domain: '.nationallife.com', name: 'ASP.NET_SessionId', expiresAt: null },
      { key: 'nlg-prod.auth0.com|auth0', domain: 'nlg-prod.auth0.com', name: 'auth0', expiresAt: '2026-07-31T03:10:00.000Z' },
    ])
    expect(JSON.stringify(summary)).not.toContain('secret')
  })

  it('treats a non-positive expiry as a session cookie', () => {
    expect(summarizeCookies({ cookies: [{ name: 'a', domain: 'x.com', expires: -1 }] })).toEqual([
      { key: 'x.com|a', domain: 'x.com', name: 'a', expiresAt: null },
    ])
  })

  it('survives a context with no cookies at all', () => {
    expect(summarizeCookies({})).toEqual([])
  })
})

describe('shiftedExpiries', () => {
  it('reports a cookie whose deadline moved forward — the sign of an idle window', () => {
    const before = summarizeCookies({
      cookies: [{ name: 'auth0', domain: 'nlg-prod.auth0.com', expires: at('2026-07-31T03:10:00Z') }],
    })
    const after = summarizeCookies({
      cookies: [{ name: 'auth0', domain: 'nlg-prod.auth0.com', expires: at('2026-07-31T04:10:00Z') }],
    })

    expect(shiftedExpiries(before, after)).toEqual({
      moved: [
        {
          key: 'nlg-prod.auth0.com|auth0',
          from: '2026-07-31T03:10:00.000Z',
          to: '2026-07-31T04:10:00.000Z',
          movedMinutes: 60,
        },
      ],
      appeared: [],
      vanished: [],
    })
  })

  it('reports nothing moved when the deadline is absolute', () => {
    const same = summarizeCookies({
      cookies: [{ name: 'auth0', domain: 'nlg-prod.auth0.com', expires: at('2026-07-31T03:10:00Z') }],
    })

    expect(shiftedExpiries(same, same).moved).toEqual([])
  })

  it('names cookies the jump added or dropped', () => {
    const before = summarizeCookies({ cookies: [{ name: 'old', domain: 'x.com' }] })
    const after = summarizeCookies({ cookies: [{ name: 'new', domain: 'x.com' }] })

    expect(shiftedExpiries(before, after)).toEqual({
      moved: [],
      appeared: ['x.com|new'],
      vanished: ['x.com|old'],
    })
  })
})

describe('hopPaths', () => {
  it('drops the query string — the SSO chain carries one-time codes there', () => {
    expect(
      hopPaths([
        'https://www.nationallife.com/agent/sso/foresight',
        'https://nlg-prod.auth0.com/authorize?client_id=abc&state=secret',
      ]),
    ).toEqual([
      'https://www.nationallife.com/agent/sso/foresight',
      'https://nlg-prod.auth0.com/authorize',
    ])
  })

  it('collapses a hop repeated back to back', () => {
    expect(hopPaths(['https://a.com/x', 'https://a.com/x?v=1', 'https://b.com/y'])).toEqual([
      'https://a.com/x',
      'https://b.com/y',
    ])
  })
})

describe('classifyLanding', () => {
  it('calls a page with a password field a login wall', () => {
    expect(
      classifyLanding('<input type="password">', 'https://nlg-prod.auth0.com/login').verdict,
    ).toBe('NEEDS_LOGIN')
  })

  it('calls a page with a log out link authenticated', () => {
    expect(
      classifyLanding('<a>Log Out</a>', 'https://www.nationallife.com/NWI/Main/Layout.aspx'),
    ).toEqual({ verdict: 'AUTHENTICATED', onAuth0: false })
  })

  it('flags the Auth0 origin so a wall is not mistaken for a dead portal', () => {
    expect(classifyLanding('<input type="password">', 'https://nlg-prod.auth0.com/login').onAuth0).toBe(
      true,
    )
  })

  it('says UNKNOWN rather than guessing', () => {
    expect(classifyLanding('<p>hello</p>', 'https://www.nationallife.com/agent/').verdict).toBe(
      'UNKNOWN',
    )
  })
})
