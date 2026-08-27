import { describe, expect, it, vi } from 'vitest'
import {
  createGridExtractionRunner,
  runGridExtraction,
  type RequestTemplate,
} from './grid-extraction'
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
    expect(h.posts.map((post) => post.type)).toEqual([
      'GRID_CHUNK', 'GRID_CHUNK', 'GRID_CHUNK', 'GRID_DONE',
    ])
  })

  it('continues from the server checkpoint instead of rereading earlier pages', async () => {
    const h = harness([
      { data: rows(100, 200), recordsTotal: 300 },
    ])
    await runGridExtraction(
      { ...MESSAGE, sequenceStart: 1, offsetStart: 200 },
      deps(h),
    )

    expect(h.fetchPage).toHaveBeenCalledTimes(1)
    expect(h.posts[0]).toMatchObject({
      type: 'GRID_CHUNK',
      sequence: 1,
      sourceOffset: 200,
      nextOffset: 300,
    })
    expect(h.posts.at(-1)).toMatchObject({ type: 'GRID_DONE' })
  })

  it('reads commission detail in larger carrier pages but emits resumable 100-row upload chunks', async () => {
    const h = harness([{ data: rows(450), recordsTotal: 450 }])

    await runGridExtraction(
      { ...MESSAGE, gridKey: 'COMMISSIONS_EARNING_REPORT' },
      deps(h),
    )

    expect(h.fetchPage).toHaveBeenCalledTimes(1)
    const request = JSON.parse(h.fetchPage.mock.calls[0]![1] as string) as {
      objJsonModel: { length: number }
    }
    expect(request.objJsonModel.length).toBe(1_000)
    expect(h.posts.slice(0, 5)).toMatchObject([
      { type: 'GRID_CHUNK', sequence: 0, sourceOffset: 0, nextOffset: 100 },
      { type: 'GRID_CHUNK', sequence: 1, sourceOffset: 100, nextOffset: 200 },
      { type: 'GRID_CHUNK', sequence: 2, sourceOffset: 200, nextOffset: 300 },
      { type: 'GRID_CHUNK', sequence: 3, sourceOffset: 300, nextOffset: 400 },
      { type: 'GRID_CHUNK', sequence: 4, sourceOffset: 400, nextOffset: 450 },
    ])
    expect((h.posts[0]!.records as unknown[])).toHaveLength(100)
    expect((h.posts[3]!.records as unknown[])).toHaveLength(100)
    expect((h.posts[4]!.records as unknown[])).toHaveLength(50)
    expect(h.posts[5]).toMatchObject({ type: 'GRID_DONE' })
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

describe('grid extraction runner', () => {
  const SECOND: BeginGridMessage = {
    type: 'BEGIN_GRID',
    gridKey: 'INFORCE_CLIENTS',
    token: 's'.repeat(32),
    correlationId: 'd'.repeat(16),
  }

  function abortFor(message: BeginGridMessage) {
    return {
      type: 'ABORT_GRID' as const,
      gridKey: message.gridKey,
      token: message.token,
      correlationId: message.correlationId,
    }
  }

  function runnerHarness(pages: { data: unknown[]; recordsTotal: number }[]) {
    const posts: Record<string, unknown>[] = []
    const fetchPage = vi.fn(async () => {
      const page = pages.shift()
      if (!page) throw new Error('PORTAL_REQUEST_FAILED')
      return pageResponse(page)
    })
    const runner = createGridExtractionRunner({
      waitForTemplate: async () => TEMPLATE,
      fetchPage: fetchPage as never,
      post: (payload: Record<string, unknown>) => posts.push(payload),
    })
    return { runner, posts, fetchPage }
  }

  it('volta a extrair no estágio seguinte a um que foi parado', async () => {
    // A pergunta que nada respondia antes: depois de uma pausa, o conector
    // volta a funcionar, ou fica morto até a aba recarregar? Uma bandeira de
    // parada que sobrevivesse ao estágio pararia o sync inteiro em silêncio, e
    // nenhum teste do laço em si a pegaria.
    const h = runnerHarness([{ data: rows(50), recordsTotal: 50 }])

    const first = h.runner.begin(MESSAGE)
    h.runner.abort(abortFor(MESSAGE))
    await first
    expect(h.posts).toEqual([])

    await h.runner.begin(SECOND)

    expect(h.fetchPage).toHaveBeenCalledTimes(1)
    expect(h.posts.at(-1)).toMatchObject({ type: 'GRID_DONE', gridKey: 'INFORCE_CLIENTS' })
  })

  it('ignora uma ordem de parar que fala de outra extração', async () => {
    const h = runnerHarness([{ data: rows(50), recordsTotal: 50 }])

    const running = h.runner.begin(MESSAGE)
    h.runner.abort(abortFor(SECOND))
    await running

    // Parar a errada é tão ruim quanto não parar: o agente veria o sync morrer
    // sem que ninguém tivesse pedido.
    expect(h.posts.at(-1)).toMatchObject({ type: 'GRID_DONE', gridKey: 'NEW_BUSINESS' })
  })

  it('uma ordem de parar com outro token não apaga uma parada real', async () => {
    // A propriedade que importa não é "uma ordem alheia não para a certa" — é
    // "uma ordem alheia não *despara* a certa". O mundo MAIN é compartilhado
    // com a página da seguradora: sem a guarda, um `setInterval` postando
    // ABORT_GRID com token qualquer sobrescreve a parada de verdade a cada
    // milissegundo, e o portal continua sendo paginado.
    const h = runnerHarness([{ data: rows(200), recordsTotal: 100_000 }])

    const first = h.runner.begin(MESSAGE)
    h.runner.abort(abortFor(MESSAGE))
    h.runner.abort(abortFor(SECOND))
    await first

    expect(h.fetchPage).not.toHaveBeenCalled()
    expect(h.posts).toEqual([])
  })

  it('recusa um BEGIN reemitido com um token que já foi parado', async () => {
    // O mundo MAIN é compartilhado com a página da National Life: um script dela
    // vê o BEGIN_GRID passar e pode reemiti-lo. Um token parado tem de continuar
    // parado, senão o replay volta a dirigir o portal depois da pausa.
    const h = runnerHarness([{ data: rows(50), recordsTotal: 50 }])

    const first = h.runner.begin(MESSAGE)
    h.runner.abort(abortFor(MESSAGE))
    await first

    await h.runner.begin(MESSAGE)

    expect(h.fetchPage).not.toHaveBeenCalled()
    expect(h.posts).toEqual([])
  })

  it('ignora um eco da mesma ordem de começar', async () => {
    const h = runnerHarness([{ data: rows(10), recordsTotal: 10 }])

    await Promise.all([h.runner.begin(MESSAGE), h.runner.begin(MESSAGE)])

    expect(h.fetchPage).toHaveBeenCalledTimes(1)
  })

  it('reporta um template que nunca apareceu', async () => {
    const posts: Record<string, unknown>[] = []
    const runner = createGridExtractionRunner({
      waitForTemplate: async () => {
        throw new Error('TEMPLATE_UNAVAILABLE')
      },
      fetchPage: (async () => pageResponse({ data: [], recordsTotal: 0 })) as never,
      post: (payload: Record<string, unknown>) => posts.push(payload),
    })

    await runner.begin(MESSAGE)

    // O `waitForTemplate` passou a ser injetado, então quem o captura mudou de
    // `try`. O código continua sendo o do portal, e não "resposta inválida".
    expect(posts).toEqual([
      {
        type: 'GRID_ERROR',
        gridKey: MESSAGE.gridKey,
        token: MESSAGE.token,
        correlationId: MESSAGE.correlationId,
        code: 'TEMPLATE_UNAVAILABLE',
      },
    ])
  })
})
