import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { locateCurrentPolicyDetailPath } from './policy-detail-locator'

const PATH = `/agent/book-of-business/inforce-book/all-clients/policy-details?id=${'a'.repeat(32)}`

function page() {
  return new JSDOM(`<!doctype html><html><body>
    <form id="ap-searchtbl-Form">
      <input id="Enter_Keywords" />
      <button type="submit">Search</button>
    </form>
    <table><tbody></tbody></table>
  </body></html>`, { url: 'https://www.nationallife.com/agent/book-of-business/inforce-book/all-clients/all-clients-agent' })
}

describe('current National Life policy detail locator', () => {
  it('searches the official All Clients form and returns only the exact policy link', async () => {
    const dom = page()
    const form = dom.window.document.querySelector('form')!
    const submitted = vi.fn((event: Event) => {
      event.preventDefault()
      dom.window.document.querySelector('tbody')!.innerHTML = `
        <tr><td><a href="${PATH}">LS1473219</a></td></tr>`
    })
    form.addEventListener('submit', submitted)

    await expect(locateCurrentPolicyDetailPath(dom.window.document, 'LS1473219', 250))
      .resolves.toBe(PATH)
    expect((dom.window.document.querySelector('#Enter_Keywords') as HTMLInputElement).value)
      .toBe('LS1473219')
    expect(submitted).toHaveBeenCalledTimes(1)
  })

  it('ignores a different policy and an unsafe lookalike route', async () => {
    const dom = page()
    dom.window.document.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault()
      dom.window.document.querySelector('tbody')!.innerHTML = `
        <tr><td><a href="${PATH}">OTHER123</a></td></tr>
        <tr><td><a href="/agent/book-of-business/inforce-book/all-clients/policy-details?id=${'b'.repeat(32)}&next=/agent/x">LS1473219</a></td></tr>`
    })

    await expect(locateCurrentPolicyDetailPath(dom.window.document, 'LS1473219', 25))
      .rejects.toThrow('POLICY_DETAIL_NOT_FOUND')
  })

  it('fails closed when the carrier search contract is unavailable', async () => {
    const dom = page()
    dom.window.document.querySelector('button')!.remove()
    await expect(locateCurrentPolicyDetailPath(dom.window.document, 'LS1473219', 25))
      .rejects.toThrow('POLICY_DETAIL_LOOKUP_UNAVAILABLE')
  })
})
