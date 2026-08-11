// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { capturePageSnapshot } from './page-snapshot'

describe('page snapshot', () => {
  it('preserves visible page, table, form, and same-origin link data', () => {
    document.title = 'Premium Report'
    document.body.innerHTML = `
      <h1>Premium Report</h1>
      <p>Total premiums $42,866.95</p>
      <table><thead><tr><th>Period</th><th>Total</th></tr></thead>
        <tbody><tr><td>YTD</td><td>$41,666.95</td></tr></tbody></table>
      <form><input name="agentNumber" value="1234"><input type="hidden" name="__RequestVerificationToken" value="secret"></form>
      <a href="/agent/book-of-business/inforce-book/all-clients?id=abc">Client</a>
      <a href="https://evil.example/data">Outside</a>
    `

    const records = capturePageSnapshot(
      document,
      new URL('https://www.nationallife.com/agent/book-of-business/inforce-book/premium-report-agency'),
    )

    expect(records).toContainEqual(expect.objectContaining({
      RecordType: 'TABLE_META',
      Headers: ['Period', 'Total'],
    }))
    expect(records).toContainEqual(expect.objectContaining({
      RecordType: 'TABLE_ROW',
      Cells: ['YTD', '$41,666.95'],
    }))
    expect(records.find((record) => record.RecordType === 'TABLE_ROW')).not.toHaveProperty('Headers')
    expect(records).toContainEqual(expect.objectContaining({
      RecordType: 'FORM_FIELD',
      Name: 'agentNumber',
      Value: '1234',
    }))
    expect(records).toContainEqual(expect.objectContaining({
      RecordType: 'AGENT_LINK',
      Href: '/agent/book-of-business/inforce-book/all-clients?id=abc',
    }))
    expect(JSON.stringify(records)).not.toContain('__RequestVerificationToken')
    expect(JSON.stringify(records)).not.toContain('evil.example')
  })

  it('never captures password, file, hidden, or token values', () => {
    document.body.innerHTML = `
      <form>
        <input type="password" name="password" value="dont-copy">
        <input type="file" name="upload">
        <input type="hidden" name="carrierToken" value="dont-copy-either">
      </form>
    `
    const records = capturePageSnapshot(document, new URL('https://www.nationallife.com/agent/'))
    expect(JSON.stringify(records)).not.toContain('dont-copy')
  })
})
