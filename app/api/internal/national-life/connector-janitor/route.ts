import * as Sentry from '@sentry/nextjs'
import { authorizeJanitorRequest } from '@/lib/national-life/local-connector/janitor-auth'
import { runLocalConnectorJanitorPass } from '@/lib/national-life/local-connector/janitor-scheduler'

const NO_STORE = { 'Cache-Control': 'no-store' }

/// Disparo manual da varredura do conector local.
///
/// Chama exatamente a mesma passada que o intervalo em processo chama — se esta
/// rota funciona, o que roda sozinho também funciona.
export async function POST(request: Request) {
  const authorized = authorizeJanitorRequest(request.headers.get('authorization'))

  // Sem segredo configurado a rota se comporta como inexistente: um 401 aqui
  // anunciaria que existe uma porta esperando por credencial.
  if (authorized === 'NOT_CONFIGURED') {
    return Response.json({ error: 'NOT_AVAILABLE' }, { status: 404, headers: NO_STORE })
  }
  if (authorized === 'DENIED') {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })
  }

  try {
    const report = await runLocalConnectorJanitorPass()
    return Response.json(report, { status: 200, headers: NO_STORE })
  } catch (error) {
    // Capturado aqui de propósito: um catch que devolve 500 não sobe para o
    // `onRequestError` do Next, e uma varredura que falha calada é como a
    // tabela volta a crescer sem ninguém notar. A resposta não devolve interno
    // de banco a quem chamou.
    Sentry.captureException(error)
    return Response.json({ error: 'SWEEP_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
