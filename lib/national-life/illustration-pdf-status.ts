import type { BrowserJobRecord } from './job-service'
import {
  FORESIGHT_SSO_EXPIRED,
  isNationalLifeLoginRequiredCode,
} from './constants'

/// What the illustration row is allowed to know about the render it asked for.
///
/// Deliberately not the job record. The agent needs "is it coming, and if not
/// why" — not lease owners, attempt counts, or an error code in English.
export type IllustrationPdfStatus =
  | { state: 'WORKING' }
  | { state: 'BLOCKED'; safeErrorCode: string | null }
  | { state: 'FAILED'; safeErrorCode: string | null }

/// Everything the queue still intends to act on. `RETRYABLE` belongs here: the
/// worker will pick it up again, and telling the agent it failed would send
/// them to click a button the queue is about to press itself.
///
/// `ACTION_REQUIRED` has never belonged in this set. Before the BLOCKED branch
/// below existed, a job in `ACTION_REQUIRED` matched nothing here and produced
/// no map entry at all — the row stayed silent about a request that was
/// actually parked on a human login, the same muteness that made the whole
/// integration read as broken. It still must not join WORKING_STATES: saying
/// "gerando" over a parked request would just be a different way of being
/// wrong. What changed is that the row now speaks for that case instead of
/// staying quiet.
const WORKING_STATES: ReadonlySet<string> = new Set([
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_MFA',
  'WAITING_FOR_REVIEW',
  'RETRYABLE',
  'CREDENTIALS_EXPIRED',
  'MANUAL_REVIEW',
])

/// The latest render job per illustration, from jobs already sorted newest
/// first. A succeeded job needs no status — the document is on the row, and the
/// row shows the link instead.
export function latestPdfStatusByIllustration(
  jobs: readonly BrowserJobRecord[],
): Map<string, IllustrationPdfStatus> {
  const byIllustration = new Map<string, IllustrationPdfStatus>()

  for (const job of jobs) {
    const illustrationId = (job.input as { illustrationId?: unknown } | null)?.illustrationId
    if (typeof illustrationId !== 'string' || byIllustration.has(illustrationId)) {
      continue
    }
    // Keep this classification aligned with the connect-time drain: every
    // login-required park speaks as waiting for the same human action.
    if (job.state === 'ACTION_REQUIRED' && isNationalLifeLoginRequiredCode(job.safeErrorCode)) {
      byIllustration.set(illustrationId, {
        state: 'BLOCKED',
        safeErrorCode: job.safeErrorCode,
      })
    } else if (WORKING_STATES.has(job.state)) {
      byIllustration.set(illustrationId, { state: 'WORKING' })
    } else if (job.state === 'FAILED') {
      byIllustration.set(illustrationId, { state: 'FAILED', safeErrorCode: job.safeErrorCode })
    }
    // SUCCEEDED and anything else: the row speaks for itself.
  }

  return byIllustration
}

/// The sentence the agent reads.
///
/// `FORESIGHT_SSO_EXPIRED` matters most because the carrier's illustration
/// tool has its own login, it dies well before the portal's, and when it does
/// there is nothing wrong with the quote — someone just has to connect again.
/// Saying "falhou" there sends the agent looking for a problem that is not in
/// the data. The portal-level reconnect code follows the same blocked path.
export function illustrationPdfMessage(status: IllustrationPdfStatus): string {
  if (status.state === 'WORKING') {
    // The number comes from measuring a full illustration opening in the
    // carrier's tool: minutes, not seconds. Without it, silence reads as broken.
    return 'PDF a caminho — costuma levar de 2 a 5 minutos.'
  }
  if (status.state === 'BLOCKED') {
    return 'Aguardando você conectar na seguradora.'
  }

  switch (status.safeErrorCode) {
    case FORESIGHT_SSO_EXPIRED:
      return 'A seguradora pediu login novo. Reconecte a integração e peça de novo.'
    case 'CARRIER_BROWSER_BUSY':
      return 'A seguradora estava ocupada. Pode pedir de novo.'
    case 'FORESIGHT_REPORT_FAILED':
      return 'A seguradora não terminou de gerar. Pode pedir de novo.'
    case null:
      return 'Não foi possível gerar.'
    default:
      // The code is shown rather than hidden: an unmapped failure is exactly
      // when the agent needs something to quote back to whoever can read it.
      return `Não foi possível gerar (${status.safeErrorCode}).`
  }
}
