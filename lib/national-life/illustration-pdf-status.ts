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
  | { state: 'WAITING_FOR_KBOT' }
  | { state: 'BLOCKED'; safeErrorCode: string | null }
  | { state: 'FAILED'; safeErrorCode: string | null }

export type IllustrationDelivery = {
  eyebrow: string
  title: string
  detail: string
}

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
  if (status.state === 'WAITING_FOR_KBOT') {
    return 'K-Bot está aguardando conexão neste computador para iniciar o mesmo pedido.'
  }
  if (status.state === 'WORKING') {
    // The number comes from measuring a full illustration opening in the
    // carrier's tool: minutes, not seconds. Without it, silence reads as broken.
    return 'K-Bot está fazendo no Foresight o que você faria: preenchendo o cenário, aguardando o cálculo e preparando o PDF. Estimativa típica: 2–5 minutos.'
  }
  if (status.state === 'BLOCKED') {
    return 'K-Bot está aguardando você entrar na National Life para continuar o mesmo pedido.'
  }

  switch (status.safeErrorCode) {
    case FORESIGHT_SSO_EXPIRED:
      return 'A seguradora pediu login novo. Reconecte a integração e peça de novo.'
    case 'CARRIER_BROWSER_BUSY':
      return 'A seguradora estava ocupada. Pode pedir de novo.'
    case 'FORESIGHT_REPORT_FAILED':
      return 'A seguradora não terminou de gerar. Pode pedir de novo.'
    case 'FORESIGHT_REPORT_TIMEOUT':
      return 'A seguradora demorou além do esperado. Pode pedir de novo.'
    case 'FORESIGHT_ARTIFACT_MISSING':
      return 'O caso foi concluído sem o PDF verificável. Gere novamente.'
    case 'COMMAND_EXPIRED':
      return 'A tentativa expirou antes de terminar. Pode pedir de novo.'
    case 'FORESIGHT_PREMIUM_WRITE_MISMATCH':
      return 'O Foresight não aceitou o prêmio mensal informado para este cenário. Revise o prêmio e gere uma nova ilustração; nenhum PDF foi emitido.'
    case 'FORESIGHT_CALCULATION_UNAVAILABLE':
      return 'O Foresight não conseguiu calcular um cenário válido com esse valor de origem. Revise o capital ou prêmio e gere uma nova ilustração; nenhum PDF foi emitido.'
    case 'FORESIGHT_CLIENT_READBACK_TIMEOUT':
      return 'O Foresight não confirmou os dados do segurado. Revise nascimento, estado e perfil de risco antes de tentar novamente; nenhum PDF foi emitido.'
    case 'FORESIGHT_TERM_FUNDING_TIMEOUT':
      return 'O Foresight ainda estava atualizando o cenário Term e não confirmou os valores a tempo. Gere novamente; nenhum PDF foi emitido.'
    case 'FORESIGHT_TERM_DURATION_READBACK_MISMATCH':
      return 'O Foresight alterou o prazo do Term durante a atualização. Revise o prazo e gere novamente; nenhum PDF foi emitido.'
    case 'FORESIGHT_TERM_PREMIUM_MISSING':
    case 'FORESIGHT_TERM_PREMIUM_MISMATCH':
    case 'FORESIGHT_TERM_PDF_INVALID':
      return 'O PDF Term foi recebido, mas os prêmios não puderam ser conferidos. Tente conferir este PDF novamente; se persistir, gere uma nova ilustração.'
    case 'FORESIGHT_TERM_CLIENT_READBACK_MISMATCH':
      return 'O Foresight devolveu dados do segurado diferentes do pedido Term. Revise o cenário e gere novamente; nenhum PDF foi emitido.'
    case 'FORESIGHT_TERM_FACE_AMOUNT_READBACK_MISMATCH':
    case 'FORESIGHT_TERM_FUNDING_READBACK_MISMATCH':
      return 'O Foresight devolveu capital ou cobrança diferentes do pedido Term. Revise o cenário e gere novamente; nenhum PDF foi emitido.'
    case 'FORESIGHT_SOLVE_READBACK_TIMEOUT':
    case 'FORESIGHT_SOLVE_READBACK_MISMATCH':
    case 'FORESIGHT_RESPONSE_INVALID':
      return 'O Foresight não devolveu um resultado verificável para este cenário. Revise o valor de origem e gere uma nova ilustração; nenhum PDF foi emitido.'
    case null:
      return 'Não foi possível gerar.'
    default:
      // The code is shown rather than hidden: an unmapped failure is exactly
      // when the agent needs something to quote back to whoever can read it.
      return `Não foi possível gerar (${status.safeErrorCode}).`
  }
}

export function describeIllustrationDelivery(input: {
  documentReady: boolean
  verified?: boolean
  status?: IllustrationPdfStatus
}): IllustrationDelivery {
  if (input.status?.state === 'FAILED' && [
    'FORESIGHT_TERM_PREMIUM_MISSING',
    'FORESIGHT_TERM_PREMIUM_MISMATCH',
    'FORESIGHT_TERM_PDF_INVALID',
  ].includes(input.status.safeErrorCode ?? '')) {
    return {
      eyebrow: 'Revisão necessária',
      title: 'Não foi possível conferir o PDF Term',
      detail: illustrationPdfMessage(input.status),
    }
  }
  if (input.documentReady && input.verified === false) {
    if (input.status?.state === 'FAILED') {
      return {
        eyebrow: 'Revisão necessária',
        title: 'O PDF foi recebido, mas a conferência não terminou',
        detail: `O arquivo foi recebido, mas o K-Bot não concluiu a conferência do resultado. Nenhum valor foi aceito como oficial. ${illustrationPdfMessage(input.status)}`,
      }
    }
    return {
      eyebrow: 'Documento recebido',
      title: 'K-Bot está conferindo o PDF oficial',
      detail: 'O arquivo foi recebido da National Life, mas os valores ainda não foram aceitos como resultado oficial.',
    }
  }
  if (input.documentReady) {
    return {
      eyebrow: 'Documento pronto',
      title: 'PDF oficial verificado',
      detail: 'O arquivo foi recebido do Foresight e conferido antes de ficar disponível aqui.',
    }
  }
  if (input.status?.state === 'BLOCKED') {
    return {
      eyebrow: 'K-Bot · ação necessária',
      title: 'Conecte a National Life para continuar',
      detail: 'A sessão do navegador expirou. Depois do login, o K-Bot retoma o mesmo pedido.',
    }
  }
  if (input.status?.state === 'WAITING_FOR_KBOT') {
    return {
      eyebrow: 'K-Bot · conexão necessária',
      title: 'Reconecte o K-Bot para iniciar',
      detail: 'O pedido oficial está salvo. Reconecte o K-Bot neste computador para ele abrir o Foresight e continuar a mesma ilustração.',
    }
  }
  if (input.status?.state === 'WORKING') {
    return {
      eyebrow: 'K-Bot em operação',
      title: 'K-Bot está gerando a ilustração oficial',
      detail: 'K-Bot está preenchendo o caso, conferindo o cálculo da National Life e preparando o PDF. Estimativa típica: 2–5 minutos; você pode continuar trabalhando.',
    }
  }
  if (input.status?.state === 'FAILED') {
    return {
      eyebrow: 'Revisão necessária',
      title: 'O Foresight não aceitou este cenário',
      detail: illustrationPdfMessage(input.status),
    }
  }
  return {
    eyebrow: 'Pedido preparado',
    title: 'Pronto para enviar ao Foresight',
    detail: 'Revise as instruções abaixo e inicie a geração oficial quando estiver pronto.',
  }
}
