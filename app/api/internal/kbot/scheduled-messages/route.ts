import * as Sentry from '@sentry/nextjs'
import { authorizeScheduledMessageRequest } from '@/lib/kbot-messaging/scheduled-auth'
import { runScheduledMessagePass } from '@/lib/kbot-messaging/scheduled-queue'

const NO_STORE = { 'Cache-Control': 'no-store' }

/// Disparo da passada de mensagens agendadas.
///
/// Mesma passada que um cron externo chama todo dia: se esta rota funciona, o
/// que roda sozinho também funciona. O relatório devolve os bloqueios com o
/// motivo, porque "ninguém recebeu parabéns hoje" precisa ter resposta.
export async function POST(request: Request) {
  const authorized = authorizeScheduledMessageRequest(request.headers.get('authorization'))

  // Sem segredo configurado a rota se comporta como inexistente: um 401 aqui
  // anunciaria que existe uma porta esperando por credencial.
  if (authorized === 'NOT_CONFIGURED') {
    return Response.json({ error: 'NOT_AVAILABLE' }, { status: 404, headers: NO_STORE })
  }
  if (authorized === 'DENIED') {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })
  }

  try {
    const report = await runScheduledMessagePass()
    return Response.json(report, { status: 200, headers: NO_STORE })
  } catch (error) {
    // Capturado aqui de propósito: um catch que devolve 500 não sobe para o
    // `onRequestError` do Next, e uma passada que falha calada é como um
    // aniversário passa em branco sem ninguém notar.
    Sentry.captureException(error)
    return Response.json({ error: 'SCHEDULED_PASS_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
