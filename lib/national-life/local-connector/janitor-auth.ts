import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

/// Segredo do disparo manual da varredura.
///
/// O intervalo em processo é quem varre no dia a dia; esta porta existe para o
/// caso em que alguém precisa varrer *agora* e ver o número — depois de um
/// incidente, ou para conferir que a varredura faz o que diz num ambiente novo.
/// Sem segredo configurado a porta não existe: sem isso ela seria um `DELETE`
/// anônimo sobre tabelas de produção.

const MIN_SECRET_LENGTH = 32

export type JanitorAuthResult = 'OK' | 'NOT_CONFIGURED' | 'DENIED'

function digest(value: string): Buffer {
  // Comparar digests de tamanho fixo, e não os segredos crus: `timingSafeEqual`
  // lança quando os tamanhos diferem, e esse lançamento por si só contaria o
  // tamanho do segredo a quem estivesse tentando.
  return createHash('sha256').update(value, 'utf8').digest()
}

export function authorizeJanitorRequest(
  authorization: string | null,
  secret: string | undefined = process.env.NATIONAL_LIFE_JANITOR_SECRET,
): JanitorAuthResult {
  const configured = secret?.trim() ?? ''
  if (configured.length < MIN_SECRET_LENGTH) return 'NOT_CONFIGURED'

  const prefix = 'Bearer '
  if (!authorization || !authorization.startsWith(prefix)) return 'DENIED'

  const presented = authorization.slice(prefix.length).trim()
  if (!presented) return 'DENIED'

  return timingSafeEqual(digest(presented), digest(configured)) ? 'OK' : 'DENIED'
}
