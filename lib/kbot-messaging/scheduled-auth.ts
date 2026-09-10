import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

/// Segredo do disparo das mensagens agendadas.
///
/// Mesma forma das irmãs (`janitor-auth`, o cron do CRM): sem segredo forte
/// configurado a porta não existe, porque sem isso ela seria um gatilho anônimo
/// capaz de enfileirar mensagem para o livro inteiro.

const MIN_SECRET_LENGTH = 32

export type ScheduledMessageAuthResult = 'OK' | 'NOT_CONFIGURED' | 'DENIED'

function digest(value: string): Buffer {
  // Comparar digests de tamanho fixo, e não os segredos crus: `timingSafeEqual`
  // lança quando os tamanhos diferem, e esse lançamento contaria o tamanho do
  // segredo a quem estivesse tentando.
  return createHash('sha256').update(value, 'utf8').digest()
}

export function authorizeScheduledMessageRequest(
  authorization: string | null,
  secret: string | undefined = process.env.KBOT_SCHEDULED_CRON_SECRET,
): ScheduledMessageAuthResult {
  const configured = secret?.trim() ?? ''
  if (configured.length < MIN_SECRET_LENGTH) return 'NOT_CONFIGURED'

  const prefix = 'Bearer '
  if (!authorization || !authorization.startsWith(prefix)) return 'DENIED'

  const presented = authorization.slice(prefix.length).trim()
  if (!presented) return 'DENIED'

  return timingSafeEqual(digest(presented), digest(configured)) ? 'OK' : 'DENIED'
}
