/// Classificação de falhas do K-Bot (pacote técnico KeeproneConnect).
///
/// Um código interno nunca chega ao agente: ele é apenas a chave que escolhe a
/// frase. O par (mensagem, ação) é o contrato — toda falha precisa dizer o que
/// fazer a seguir, e `support` é fallback de verdade, não o caso comum.
///
/// A página web tem o seu próprio mapa em
/// `lib/national-life/local-connector/connector-failure.ts`. São superfícies
/// diferentes (popup de uma linha vs. cartão com botão), por isso o texto é
/// escrito duas vezes de propósito; as classes de falha é que são as mesmas.

export type ConnectorFailureAction =
  | 'reconnect'
  | 'pairing'
  | 'retry'
  | 'update'
  | 'paused'
  | 'subscription'
  | 'support'

export type ConnectorFailure = {
  message: string
  action: ConnectorFailureAction
}

/// Afirmação explícita do servidor: esta identidade não existe mais. É a única
/// coisa que autoriza apagar a chave privada. Um 401 genérico não serve — ele
/// cobre relógio fora da janela, que persiste depois de reparear e transformaria
/// a limpeza num laço.
export const DEVICE_REVOKED = 'DEVICE_REVOKED'

export const RECONNECT_CODES: readonly string[] = [
  DEVICE_REVOKED,
  // Sem chave privada local não há como assinar nada, nunca. Reconectar é a
  // única saída — mas não há chave para apagar.
  'DEVICE_KEY_UNAVAILABLE',
]

/// A conexão nunca chegou a existir; não há o que "re"conectar.
export const PAIRING_CODES: readonly string[] = ['PAIRING_REJECTED', 'PAIRING_FAILED']

/// Subconjunto de RECONNECT_CODES que autoriza destruir o material local.
const REVOKING_CODES: readonly string[] = [DEVICE_REVOKED]

/// O servidor mandou um plano que esta versão da extensão não sabe executar.
export const OUTDATED_CODES: readonly string[] = [
  'UNKNOWN_CAPABILITY',
  'UNSAFE_NAVIGATE_PATH',
  'INVALID_RUN_RESPONSE',
  'PATH_NOT_ALLOWED',
  // 426 do servidor: esta versão está abaixo do piso. É a única classe em que
  // "atualize" não é um palpite — foi o servidor que disse.
  'CLIENT_TOO_OLD',
]

/// O servidor desligou o conector de propósito. Não é falha do agente nem do
/// portal, e não é coisa que atualizar resolva — a saída é esperar.
export const PAUSED_CODES: readonly string[] = ['CONNECTOR_PAUSED']

export const RATE_LIMIT_CODES: readonly string[] = ['RUN_START_RATE_LIMITED']

/// A conta perdeu o acesso comercial, mas este computador continua pareado.
/// Repetir ou reconectar não resolve; a saída acontece no plano Keepr One.
export const SUBSCRIPTION_CODES: readonly string[] = ['FOUNDER_ACCESS_REQUIRED']

export const RECONCILIATION_CODES: readonly string[] = [
  'STAGE_INCOMPLETE',
  'STAGE_TRUNCATED',
  'SYNC_INCOMPLETE',
]

/// O portal (ou a ponte com ele) não respondeu como esperado. Costuma passar.
export const PORTAL_CODES: readonly string[] = [
  'PORTAL_REQUEST_FAILED',
  'TEMPLATE_UNAVAILABLE',
  'INVALID_PORTAL_RESPONSE',
  'BRIDGE_UNAVAILABLE',
  'DEVICE_REQUEST_FAILED',
  'CONNECTOR_TAB_CLOSED',
  'PORTAL_ROUTE_CHANGED',
  'STAGE_INCOMPLETE',
  'STAGE_TRUNCATED',
  'LOCAL_CONNECTOR_TIMEOUT',
]

export function revokesDevice(code: string | undefined | null): boolean {
  return typeof code === 'string' && REVOKING_CODES.includes(code)
}

export function connectorFailure(code: string | undefined | null): ConnectorFailure {
  if (typeof code === 'string' && RECONNECT_CODES.includes(code)) {
    return {
      action: 'reconnect',
      message:
        'This computer is no longer linked to your Keepr One account. Reconnect it from the National Life page in Keepr One.',
    }
  }
  if (typeof code === 'string' && PAIRING_CODES.includes(code)) {
    return {
      action: 'pairing',
      message:
        'Connecting this computer did not finish. Start over from the National Life page in Keepr One.',
    }
  }
  if (typeof code === 'string' && OUTDATED_CODES.includes(code)) {
    return {
      action: 'update',
      message:
        'K-Bot is out of date. Update the extension in your browser, then start the task again.',
    }
  }
  if (typeof code === 'string' && PAUSED_CODES.includes(code)) {
    return {
      action: 'paused',
      message:
        'Syncing is paused by Keepr One right now. Nothing is wrong with this computer — we will turn it back on.',
    }
  }
  if (typeof code === 'string' && RATE_LIMIT_CODES.includes(code)) {
    return {
      action: 'retry',
      message:
        'Too many sync attempts were started. Wait a few minutes, then try once — your National Life connection is still intact.',
    }
  }
  if (typeof code === 'string' && SUBSCRIPTION_CODES.includes(code)) {
    return {
      action: 'subscription',
      message:
        'Your Keepr One access needs an active subscription. Activate a subscription for your plan in Keepr One to sync again — this computer remains linked.',
    }
  }
  if (typeof code === 'string' && RECONCILIATION_CODES.includes(code)) {
    return {
      action: 'retry',
      message:
        'National Life stopped before this section was finished. Everything K-Bot already collected is safe — resume to bring in the rest.',
    }
  }
  if (typeof code === 'string' && PORTAL_CODES.includes(code)) {
    return {
      action: 'retry',
      message:
        'National Life did not respond. This usually clears up on its own — wait a minute and try again.',
    }
  }
  return {
    action: 'support',
    message:
      'The sync stopped before it finished. Try again — if it keeps happening, contact Keepr One support.',
  }
}
