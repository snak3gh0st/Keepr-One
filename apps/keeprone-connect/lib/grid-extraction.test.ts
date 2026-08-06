import { describe, expect, it, vi } from 'vitest'
import { runGridExtraction, type RequestTemplate } from './grid-extraction'
import type { BeginGridMessage } from './messages'

const MESSAGE: BeginGridMessage = {
  type: 'BEGIN_GRID',
  gridKey: 'NEW_BUSINESS',
  token: 't'.repeat(32),
  correlationId: 'c'.repeat(16),
}

const TEMPLATE: RequestTemplate = {
  body: JSON.stringify({ objJsonModel: { start: 0, length: 200, draw: 1 } }),
  headers: { 'content-type': 'application/json' },
}

function rows(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({ policy: `P-${offset + index}` }))
}

function pageResponse(body: { data: unknown[]; recordsTotal: number }) {
  return { ok: true, json: async () => body } as unknown as Response
}

type Harness = {
  posts: Record<string, unknown>[]
  fetchPage: ReturnType<typeof vi.fn>
  aborted: () => boolean
  abortNow: () => void
}

function harness(pages: { data: unknown[]; recordsTotal: number }[]): Harness {
  const posts: Record<string, unknown>[] = []
  let stop = false
  const fetchPage = vi.fn(async () => {
    const page = pages.shift()
    if (!page) throw new Error('PORTAL_REQUEST_FAILED')
    return pageResponse(page)
  })
  return {
    posts,
    fetchPage,
    aborted: () => stop,
    abortNow: () => {
      stop = true
    },
  }
}

function deps(h: Harness, overrides: Partial<Parameters<typeof runGridExtraction>[1]> = {}) {
  return {
    waitForTemplate: async () => TEMPLATE,
    fetchPage: h.fetchPage as never,
    post: (payload: Record<string, unknown>) => h.posts.push(payload),
    aborted: h.aborted,
    ...overrides,
  }
}

describe('grid extraction', () => {
  it('pages until the carrier total is covered and reports done', async () => {
    const h = harness([
      { data: rows(200), recordsTotal: 300 },
      { data: rows(100, 200), recordsTotal: 300 },
    ])

    await runGridExtraction(MESSAGE, deps(h))

    expect(h.fetchPage).toHaveBeenCalledTimes(2)
    expect(h.posts.map((post) => post.type)).toEqual(['GRID_CHUNK', 'GRID_CHUNK', 'GRID_DONE'])
  })

  it('sends one empty chunk for a grid with no rows', async () => {
    const h = harness([{ data: [], recordsTotal: 0 }])

    await runGridExtraction(MESSAGE, deps(h))

    expect(h.posts).toHaveLength(2)
    expect(h.posts[0]).toMatchObject({ type: 'GRID_CHUNK', sequence: 0, records: [] })
    expect(h.posts[1]).toMatchObject({ type: 'GRID_DONE' })
  })

  it('reports a portal failure with its own code', async () => {
    const h = harness([])

    await runGridExtraction(MESSAGE, deps(h))

    expect(h.posts).toEqual([
      {
        type: 'GRID_ERROR',
        gridKey: MESSAGE.gridKey,
        token: MESSAGE.token,
        correlationId: MESSAGE.correlationId,
        code: 'PORTAL_REQUEST_FAILED',
      },
    ])
  })
})

describe('grid extraction abort', () => {
  it('never touches the portal when the order arrived before the first page', async () => {
    const h = harness([{ data: rows(200), recordsTotal: 400 }])
    h.abortNow()

    await runGridExtraction(MESSAGE, deps(h))

    // O ponto inteiro do recurso: a National Life não é tocada mais uma vez.
    expect(h.fetchPage).not.toHaveBeenCalled()
    expect(h.posts).toEqual([])
  })

  it('stops before the next page instead of finishing the stage', async () => {
    const h = harness([
      { data: rows(200), recordsTotal: 100_000 },
      { data: rows(200, 200), recordsTotal: 100_000 },
    ])
    const withAbortAfterFirstPage = deps(h, {
      post: (payload: Record<string, unknown>) => {
        h.posts.push(payload)
        h.abortNow()
      },
    })

    await runGridExtraction(MESSAGE, withAbortAfterFirstPage)

    // Uma grade de 100.000 linhas são 500 páginas. Sem a parada, o servidor
    // recusa o lote e o portal segue sendo paginado pelas 499 restantes.
    expect(h.fetchPage).toHaveBeenCalledTimes(1)
    expect(h.posts.map((post) => post.type)).toEqual(['GRID_CHUNK'])
  })

  it('drops a page that landed after the order and posts nothing from it', async () => {
    const h = harness([{ data: rows(200), recordsTotal: 100_000 }])
    const abortDuringFlight = deps(h, {
      fetchPage: vi.fn(async () => {
        h.abortNow()
        return pageResponse({ data: rows(200), recordsTotal: 100_000 })
      }) as never,
    })

    await runGridExtraction(MESSAGE, abortDuringFlight)

    // Subir os lotes desta página seria escrever dado de um run que o servidor
    // já recusou.
    expect(h.posts).toEqual([])
  })

  it('stays silent on abort so the real failure reason survives', async () => {
    const h = harness([{ data: rows(200), recordsTotal: 400 }])
    h.abortNow()

    await runGridExtraction(MESSAGE, deps(h))

    // Um GRID_ERROR aqui chegaria ao background depois de failSync e trocaria
    // "conector pausado" por "resposta inválida" na tela do agente.
    expect(h.posts.some((post) => post.type === 'GRID_ERROR')).toBe(false)
    expect(h.posts.some((post) => post.type === 'GRID_DONE')).toBe(false)
  })
})
