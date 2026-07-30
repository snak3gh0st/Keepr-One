import { describe, expect, it } from 'vitest'
import { monetaryCells, parseRenderedTable } from './rendered-table'

const PREMIUM_HTML = `
<table class="table-condensed">
  <thead><tr><th>YTD</th><th>Life</th><th>Total</th><th>Excess</th><th>Total</th></tr></thead>
  <tbody>
    <tr><td>2026</td><td>$1,234.56</td><td>$2,000.00</td><td>$0.00</td><td>$3,234.56</td></tr>
    <tr><td>2025</td><td>$900.00</td><td>$1,000.00</td><td>-$50.00</td><td>$1,850.00</td></tr>
    <tr><td></td><td></td><td></td><td></td><td></td></tr>
  </tbody>
</table>`

describe('National Life rendered report tables', () => {
  it('reads a server-rendered report into records keyed by header', () => {
    const table = parseRenderedTable(PREMIUM_HTML)

    expect(table?.rows).toHaveLength(2)
    expect(table?.rows[0]).toMatchObject({ YTD: '2026', Life: '$1,234.56' })
  })

  it('keeps both columns when a report repeats a header', () => {
    // The premium report has two different columns both labelled "Total";
    // collapsing them would lose a real figure.
    const table = parseRenderedTable(PREMIUM_HTML)

    expect(table?.headers).toContain('Total')
    expect(table?.headers).toContain('Total (2)')
    expect(table?.rows[0]['Total']).toBe('$2,000.00')
    expect(table?.rows[0]['Total (2)']).toBe('$3,234.56')
  })

  it('drops a row of blanks', () => {
    expect(parseRenderedTable(PREMIUM_HTML)?.rows.every((row) => Object.values(row).some(Boolean))).toBe(
      true,
    )
  })

  it('returns null when the requested table is absent', () => {
    expect(parseRenderedTable('<p>no tables</p>')).toBeNull()
    expect(parseRenderedTable(PREMIUM_HTML, 5)).toBeNull()
  })

  it('picks out the monetary cells and leaves labels alone', () => {
    const table = parseRenderedTable(PREMIUM_HTML)
    const amounts = monetaryCells(table!.rows[0])

    expect(amounts).toMatchObject({ Life: '$1,234.56', 'Total (2)': '$3,234.56' })
    // A year is a number but not money.
    expect(amounts).not.toHaveProperty('YTD')
  })

  it('recognises negative and parenthesised amounts', () => {
    const amounts = monetaryCells({ a: '-$50.00', b: '(1,200.00)', c: 'Pending' })
    expect(Object.keys(amounts).sort()).toEqual(['a', 'b'])
  })
})
