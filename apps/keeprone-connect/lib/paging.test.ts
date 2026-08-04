import { describe, expect, it } from 'vitest'
import { buildPageBody, MAX_PORTAL_RECORDS, nextPageStart, parsePortalPage } from './paging'

describe('portal paging helpers', () => {
  it('updates a form-encoded DataTables model while preserving its identity', () => {
    const form = new URLSearchParams({
      DatatableId: 'AllClients',
      objJsonModel: JSON.stringify({ start: 0, length: 25, draw: 2, search: { value: '' } }),
    })
    const result = new URLSearchParams(buildPageBody(form.toString(), 500, 700, 9))
    expect(result.get('DatatableId')).toBe('AllClients')
    expect(JSON.parse(result.get('objJsonModel')!)).toEqual({
      start: 500,
      length: 500,
      draw: 9,
      search: { value: '' },
    })
  })

  it('updates JSON templates with stringified nested models', () => {
    const body = buildPageBody(
      JSON.stringify({ DatatableId: 'Cases', objJsonModel: JSON.stringify({ start: 0 }) }),
      1_000,
    )
    const parsed = JSON.parse(body)
    expect(parsed.DatatableId).toBe('Cases')
    expect(JSON.parse(parsed.objJsonModel)).toMatchObject({ start: 1_000, length: 500 })
  })

  it('caps totals and stops on empty or final pages', () => {
    expect(parsePortalPage({ aaData: [{}], iTotalRecords: '100001' })).toEqual({
      rows: [{}],
      recordsTotal: MAX_PORTAL_RECORDS,
      truncated: true,
    })
    expect(nextPageStart(0, 500, 501)).toBe(500)
    expect(nextPageStart(500, 1, 501)).toBeNull()
    expect(nextPageStart(0, 0, 100)).toBeNull()
  })
})
