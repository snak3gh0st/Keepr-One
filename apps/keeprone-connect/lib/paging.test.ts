import { describe, expect, it } from 'vitest'
import { buildPageBody, MAX_PORTAL_RECORDS, nextPageStart, PAGE_SIZE, parsePortalPage } from './paging'

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
      length: 200,
      draw: 9,
      search: { value: '' },
    })
  })

  it('pages at the raw-row size cap', () => {
    expect(PAGE_SIZE).toBe(200)
  })

  it('marks only the page that is actually short as truncated', () => {
    const page = parsePortalPage({ data: [{ PolicyNo: 'X1' }], recordsTotal: 500 })
    expect(page.truncated).toBe(false)
  })

  it('marks truncated when the carrier total exceeds what we will fetch', () => {
    const page = parsePortalPage({ data: [{ PolicyNo: 'X1' }], recordsTotal: 200_001 })
    expect(page.truncated).toBe(true)
  })

  it('updates JSON templates with stringified nested models', () => {
    const body = buildPageBody(
      JSON.stringify({ DatatableId: 'Cases', objJsonModel: JSON.stringify({ start: 0 }) }),
      1_000,
    )
    const parsed = JSON.parse(body)
    expect(parsed.DatatableId).toBe('Cases')
    expect(JSON.parse(parsed.objJsonModel)).toMatchObject({ start: 1_000, length: 200 })
  })

  it('caps totals and stops on empty or final pages', () => {
    expect(parsePortalPage({ aaData: [{}], iTotalRecords: '200001' })).toEqual({
      rows: [{}],
      recordsTotal: MAX_PORTAL_RECORDS,
      truncated: true,
    })
    expect(nextPageStart(0, 500, 501)).toBe(500)
    expect(nextPageStart(500, 1, 501)).toBeNull()
    expect(nextPageStart(0, 0, 100)).toBeNull()
  })
})
