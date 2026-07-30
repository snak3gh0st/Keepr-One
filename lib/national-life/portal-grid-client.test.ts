import { describe, expect, it } from 'vitest'
import {
  NationalLifeGridError,
  fetchNationalLifeGrid,
  rowsFrom,
  withOffset,
  type GridPage,
} from './portal-grid-client'

const TEMPLATE = {
  objJsonModel: {
    draw: 1,
    columns: [{ data: 'PolicyNo' }],
    order: [{ column: 1, dir: 'desc' }],
    start: 0,
    length: 10,
    DatatableId: 'opaque-grid-token',
    filters: [],
  },
}

function createPage(options: {
  pages?: Array<{ recordsTotal?: number; data?: Array<Record<string, unknown>> }>
  postData?: string | null
  observeRequest?: boolean
  status?: number
}) {
  const posted: Array<{ url: string; body: unknown }> = []
  let call = 0

  const page: GridPage = {
    url: () => 'https://www.nationallife.com/agent/',
    async goto() {
      return undefined
    },
    async waitForRequest(predicate) {
      if (options.observeRequest === false) {
        throw new Error('timeout')
      }
      // Sanity-check the predicate the client hands us.
      expect(
        predicate({
          url: () => 'https://www.nationallife.com/agent/Datatable/GetJsonResult',
          method: () => 'POST',
        }),
      ).toBe(true)
      expect(
        predicate({
          url: () => 'https://www.nationallife.com/agent/other',
          method: () => 'POST',
        }),
      ).toBe(false)
      return {
        url: () => 'https://www.nationallife.com/agent/Datatable/GetJsonResult',
        postData: () =>
          options.postData === undefined ? JSON.stringify(TEMPLATE) : options.postData,
        headers: () => ({ 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }),
      }
    },
    async waitForTimeout() {
      return undefined
    },
    request: {
      async post(url, init) {
        posted.push({ url, body: init.data })
        const payload = options.pages?.[call] ?? { data: [] }
        call += 1
        return {
          ok: () => (options.status ?? 200) < 400,
          status: () => options.status ?? 200,
          async json() {
            return payload
          },
        }
      },
    },
  }

  return { page, posted }
}

describe('National Life portal grid client', () => {
  it('replays the captured request body instead of rebuilding it', async () => {
    const { page, posted } = createPage({
      pages: [{ recordsTotal: 1, data: [{ PolicyNo: 'A1' }] }],
    })

    const result = await fetchNationalLifeGrid(page, '/agent/grid', 'https://www.nationallife.com/agent/auth/login')

    expect(result.rows).toEqual([{ PolicyNo: 'A1' }])
    expect(result.recordsTotal).toBe(1)
    // The opaque grid token must survive untouched.
    expect(posted[0].body).toMatchObject({
      objJsonModel: { DatatableId: 'opaque-grid-token', start: 0 },
    })
  })

  it('pages until the reported total is reached', async () => {
    const full = Array.from({ length: 2 }, (_, index) => ({ PolicyNo: `p${index}` }))
    const { page, posted } = createPage({
      pages: [
        { recordsTotal: 3, data: full },
        { recordsTotal: 3, data: [{ PolicyNo: 'p2' }] },
      ],
    })

    const result = await fetchNationalLifeGrid(
      page,
      '/agent/grid',
      'https://www.nationallife.com/agent/auth/login',
      { pageSize: 2 },
    )

    expect(result.rows).toHaveLength(3)
    expect(posted.map((entry) => (entry.body as typeof TEMPLATE).objJsonModel.start)).toEqual([0, 2])
  })

  it('stops on a short page even when the total is missing', async () => {
    const { page, posted } = createPage({ pages: [{ data: [{ PolicyNo: 'only' }] }] })

    const result = await fetchNationalLifeGrid(
      page,
      '/agent/grid',
      'https://www.nationallife.com/agent/auth/login',
      { pageSize: 50 },
    )

    expect(result.rows).toHaveLength(1)
    expect(result.recordsTotal).toBe(1)
    expect(posted).toHaveLength(1)
  })

  it('reports when the grid never issues its JSON request', async () => {
    const { page } = createPage({ observeRequest: false })

    await expect(
      fetchNationalLifeGrid(page, '/agent/grid', 'https://www.nationallife.com/agent/auth/login'),
    ).rejects.toMatchObject({ code: 'GRID_REQUEST_NOT_OBSERVED' })
  })

  it('reports a rejected endpoint rather than returning empty data', async () => {
    const { page } = createPage({ pages: [{ data: [] }], status: 403 })

    await expect(
      fetchNationalLifeGrid(page, '/agent/grid', 'https://www.nationallife.com/agent/auth/login'),
    ).rejects.toMatchObject({ code: 'GRID_REQUEST_REJECTED' })
  })

  it('refuses a body without the expected envelope', () => {
    expect(() => withOffset({ nope: true }, 0, 10)).toThrow(NationalLifeGridError)
  })

  it('never mutates the captured template', () => {
    const template = structuredClone(TEMPLATE)
    withOffset(template, 40, 20)
    expect(template.objJsonModel.start).toBe(0)
    expect(template.objJsonModel.length).toBe(10)
  })

  it('advances draw with the offset', () => {
    const shifted = withOffset(TEMPLATE, 40, 20) as typeof TEMPLATE
    expect(shifted.objJsonModel).toMatchObject({ start: 40, length: 20, draw: 3 })
  })

  it('treats a missing data array as no rows', () => {
    expect(rowsFrom({})).toEqual([])
  })
})

describe('National Life grid pagination completeness', () => {
  it('reports truncation when the backstop cuts a grid short', async () => {
    const { page } = createPage({
      pages: [{ recordsTotal: 500, data: [{ PolicyNo: 'a' }, { PolicyNo: 'b' }] }],
    })

    const result = await fetchNationalLifeGrid(
      page,
      '/agent/grid',
      'https://www.nationallife.com/agent/auth/login',
      { pageSize: 2, maxRows: 2 },
    )

    expect(result.rows).toHaveLength(2)
    expect(result.recordsTotal).toBe(500)
    expect(result.truncated).toBe(true)
  })

  it('reports a complete extraction as not truncated', async () => {
    const { page } = createPage({
      pages: [{ recordsTotal: 2, data: [{ PolicyNo: 'a' }, { PolicyNo: 'b' }] }],
    })

    const result = await fetchNationalLifeGrid(
      page,
      '/agent/grid',
      'https://www.nationallife.com/agent/auth/login',
      { pageSize: 2 },
    )

    expect(result.truncated).toBe(false)
  })

  it('pages past ten thousand rows, which the old ceiling silently cut', async () => {
    const bigPage = Array.from({ length: 100 }, (_, i) => ({ PolicyNo: `p${i}` }))
    const pages = Array.from({ length: 103 }, () => ({ recordsTotal: 10_272, data: bigPage }))
    pages[102] = { recordsTotal: 10_272, data: bigPage.slice(0, 72) }
    const { page } = createPage({ pages })

    const result = await fetchNationalLifeGrid(
      page,
      '/agent/grid',
      'https://www.nationallife.com/agent/auth/login',
      { pageSize: 100 },
    )

    expect(result.rows).toHaveLength(10_272)
    expect(result.truncated).toBe(false)
  })
})
