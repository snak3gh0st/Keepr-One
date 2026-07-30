import { describe, expect, it } from 'vitest'
import { portalRoutesIn } from './portal-routes'

describe('portalRoutesIn', () => {
  it('finds the agent routes a nav links to', () => {
    const html = `
      <nav>
        <a href="/agent/book-of-business/new-business/all-new-business-cases">Cases</a>
        <a href="/agent/compensation/commissions/paid-commissions">Paid</a>
      </nav>`

    expect(portalRoutesIn(html)).toEqual([
      '/agent/book-of-business/new-business/all-new-business-cases',
      '/agent/compensation/commissions/paid-commissions',
    ])
  })

  it('resolves absolute carrier URLs to the same route as relative ones', () => {
    const html = `
      <a href="https://www.nationallife.com/agent/compensation/commissions/overview">A</a>
      <a href="/agent/compensation/commissions/overview">B</a>`

    expect(portalRoutesIn(html)).toEqual(['/agent/compensation/commissions/overview'])
  })

  it('drops the query string that carries drill-down tokens', () => {
    const html = `
      <a href="/agent/book-of-business/inforce-book/all-clients/policy-details?id=0f3a9c2b4d5e6f7a">X</a>`

    expect(portalRoutesIn(html)).toEqual([
      '/agent/book-of-business/inforce-book/all-clients/policy-details',
    ])
  })

  it('collapses record ids in the path so a drill-down is one route, not thousands', () => {
    const html = `
      <a href="/agent/policy/0f3a9c2b4d5e6f7a8b9c0d1e2f3a4b5c/details">One</a>
      <a href="/agent/policy/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d/details">Two</a>`

    expect(portalRoutesIn(html)).toEqual(['/agent/policy/{id}/details'])
  })

  it('ignores off-origin, anchor and javascript links', () => {
    const html = `
      <a href="https://evil.example.com/agent/steal">No</a>
      <a href="#top">No</a>
      <a href="javascript:void(0)">No</a>
      <a href="mailto:someone@example.com">No</a>
      <a href="/agent/tools/illustrations">Yes</a>`

    expect(portalRoutesIn(html)).toEqual(['/agent/tools/illustrations'])
  })

  it('ignores non-agent areas of the site', () => {
    const html = `
      <a href="/about-us">No</a>
      <a href="/agent/marketing">Yes</a>`

    expect(portalRoutesIn(html)).toEqual(['/agent/marketing'])
  })

  it('treats a trailing slash as the same route', () => {
    const html = `
      <a href="/agent/compensation/commissions/">A</a>
      <a href="/agent/compensation/commissions">B</a>`

    expect(portalRoutesIn(html)).toEqual(['/agent/compensation/commissions'])
  })

  it('keeps the portal root itself, which is the page worth probing first', () => {
    expect(portalRoutesIn('<a href="/agent/">Home</a>')).toEqual(['/agent/'])
  })

  it('handles single-quoted and uppercase attributes', () => {
    const html = `<A HREF='/agent/tools/forms'>Forms</A>`

    expect(portalRoutesIn(html)).toEqual(['/agent/tools/forms'])
  })

  it('returns nothing for a page with no links rather than throwing', () => {
    expect(portalRoutesIn('<html><body><p>nothing</p></body></html>')).toEqual([])
  })
})
