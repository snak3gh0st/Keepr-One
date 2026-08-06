import { buildPageBody, nextPageStart, PAGE_SIZE, parsePortalPage } from './paging'
import type { AbortGridMessage, BeginGridMessage } from './messages'

/// O laço que pagina uma grade do portal.
///
/// Mora aqui, e não dentro do content script, por um motivo só: é o único lugar
/// do sistema que dirige a National Life, e precisava ser testável. Enquanto
/// estava embutido no `defineContentScript` nenhum teste o alcançava — inclusive
/// a parada em voo, que é justamente a garantia que se dá à seguradora.

export type RequestTemplate = {
  body: string
  headers: Record<string, string>
}

export type GridExtractionDeps = {
  /// Espera o portal revelar o corpo da própria requisição de grade.
  waitForTemplate: () => Promise<RequestTemplate>
  fetchPage: (template: RequestTemplate, body: string) => Promise<Response>
  post: (payload: Record<string, unknown>) => void
  /// Consultada antes de cada ida ao portal e de novo quando a página volta.
  aborted: () => boolean
}

const KNOWN_CODES = ['TEMPLATE_UNAVAILABLE', 'PORTAL_REQUEST_FAILED', 'INVALID_PORTAL_RESPONSE']

export async function runGridExtraction(
  message: BeginGridMessage,
  deps: GridExtractionDeps,
): Promise<void> {
  try {
    const requestTemplate = await deps.waitForTemplate()
    let start = 0
    let draw = 1
    let sequence = 0
    let sentAny = false

    while (true) {
      // Antes de bater no portal de novo. É o ponto que faz a pausa do servidor
      // alcançar um run em voo: sem ele a National Life continua sendo paginada
      // até o estágio acabar sozinho, minutos depois de o servidor ter recusado
      // o lote. Sai calado — o background já gravou o ERROR e já parou de
      // escutar esta aba; um GRID_ERROR aqui só sobrescreveria o motivo
      // verdadeiro por "resposta inválida".
      if (deps.aborted()) return

      const body = buildPageBody(requestTemplate.body, start, PAGE_SIZE, draw)
      const response = await deps.fetchPage(requestTemplate, body)
      if (!response.ok) throw new Error('PORTAL_REQUEST_FAILED')
      const page = parsePortalPage(await response.json())

      // A ordem pode ter chegado enquanto esta página estava no ar. Subir os
      // lotes dela seria escrever dado de um run que o servidor já recusou.
      if (deps.aborted()) return

      // Rows go up exactly as the carrier returned them. The only thing dropped
      // is a row that is not a plain object, which is a shape the envelope cannot
      // carry — not a judgment about its contents. There is no per-policy
      // deduplication here any more: it required knowing each grid's key field,
      // and the server dedupes by its own upsert key.
      const records = page.rows.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null && !Array.isArray(row),
      )
      // A carrier that ignores `length` can hand back more rows than a page, so
      // slice to the cap the envelope accepts rather than losing the whole chunk.
      for (let offset = 0; offset < records.length; offset += PAGE_SIZE) {
        deps.post({
          type: 'GRID_CHUNK',
          gridKey: message.gridKey,
          token: message.token,
          correlationId: message.correlationId,
          sequence,
          recordsTotal: page.recordsTotal,
          truncated: page.truncated,
          records: records.slice(offset, offset + PAGE_SIZE),
        })
        sequence += 1
        sentAny = true
      }
      const next = nextPageStart(start, page.rows.length, page.recordsTotal)
      if (next === null) {
        if (!sentAny) {
          deps.post({
            type: 'GRID_CHUNK',
            gridKey: message.gridKey,
            token: message.token,
            correlationId: message.correlationId,
            sequence: 0,
            recordsTotal: page.recordsTotal,
            truncated: page.truncated,
            records: [],
          })
        }
        break
      }
      start = next
      draw += 1
    }
    deps.post({
      type: 'GRID_DONE',
      gridKey: message.gridKey,
      token: message.token,
      correlationId: message.correlationId,
    })
  } catch (error) {
    const code =
      error instanceof Error && KNOWN_CODES.includes(error.message)
        ? error.message
        : 'INVALID_PORTAL_RESPONSE'
    deps.post({
      type: 'GRID_ERROR',
      gridKey: message.gridKey,
      token: message.token,
      correlationId: message.correlationId,
      code,
    })
  }
}

export type GridExtractionRunner = {
  begin: (message: BeginGridMessage) => Promise<void>
  abort: (message: AbortGridMessage) => void
}

/// O ciclo de vida em volta do laço: qual extração está rodando e qual recebeu
/// ordem de parar.
///
/// Mora aqui pelo mesmo motivo que o laço. Enquanto era um par de variáveis
/// soltas dentro do `defineContentScript`, nada respondia à única pergunta que
/// importa depois de uma pausa: o estágio *seguinte* volta a extrair? Uma
/// bandeira de parada que sobrevivesse ao estágio mataria o sync em silêncio, e
/// nenhum teste do laço em si pegaria isso.
export function createGridExtractionRunner(
  deps: Omit<GridExtractionDeps, 'aborted'>,
): GridExtractionRunner {
  let runningToken: string | null = null
  /// Token da extração que recebeu ordem de parar, e não um booleano.
  ///
  /// É o que torna a bandeira segura sem nenhuma guarda em volta: quem consulta
  /// compara com o próprio token, então uma ordem atrasada não alcança a
  /// extração seguinte — o background sorteia um token novo por estágio. E um
  /// token que foi parado permanece parado, o que é a resposta certa para o
  /// único jeito de ele voltar: o mundo MAIN é compartilhado com a página da
  /// seguradora, e um script dela pode reemitir um `BEGIN_GRID` que viu passar.
  /// Zerar a bandeira faria esse replay dirigir o portal.
  let abortedToken: string | null = null

  return {
    async begin(message) {
      // Uma segunda BEGIN com o mesmo token é eco, não trabalho novo.
      if (runningToken === message.token) return
      runningToken = message.token
      try {
        await runGridExtraction(message, {
          ...deps,
          aborted: () => abortedToken === message.token,
        })
      } finally {
        runningToken = null
      }
    },
    abort(message) {
      abortedToken = message.token
    },
  }
}
