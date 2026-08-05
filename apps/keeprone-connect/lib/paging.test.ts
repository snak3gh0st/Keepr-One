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

  it('never asks the carrier for more rows than one envelope may carry', () => {
    // 200 is the server's per-envelope record cap (LOCAL_CONNECTOR_MAX_RECORDS). A page
    // request above it would produce chunks the ingest endpoint rejects.
    const template = new URLSearchParams({
      objJsonModel: JSON.stringify({ start: 0, length: 25 }),
    })
    for (const requested of [PAGE_SIZE, 500, 10_000]) {
      const body = new URLSearchParams(buildPageBody(template.toString(), 0, requested))
      expect(JSON.parse(body.get('objJsonModel')!).length).toBeLessThanOrEqual(200)
    }
    const byDefault = new URLSearchParams(buildPageBody(template.toString(), 0))
    expect(JSON.parse(byDefault.get('objJsonModel')!).length).toBe(200)
  })

  it('does not truncate a grid that only the old ceiling would have clamped', () => {
    // Above the previous 100_000 ceiling and below the current one: the whole total is
    // reported and nothing is marked incomplete, so the server can finalize the stage.
    const page = parsePortalPage({ data: [{ PolicyNo: 'X1' }], recordsTotal: 150_000 })
    expect(page).toEqual({ rows: [{ PolicyNo: 'X1' }], recordsTotal: 150_000, truncated: false })
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
