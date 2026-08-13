/// O que o agente lê quando o KeeproneConnect falha.
///
/// O código interno é só a chave que escolhe a frase — ele nunca aparece. Cada
/// classe de falha devolve, junto do texto, o rótulo do botão que resolve
/// aquela falha: um erro sem ação possível é um beco sem saída, e beco sem
/// saída para um agente que não é técnico é defeito.
///
/// A extensão tem o seu próprio mapa em `apps/keeprone-connect/lib/failure.ts`.
/// São superfícies diferentes (popup de uma linha vs. cartão com botões), então
/// o texto é escrito duas vezes de propósito; o que precisa coincidir são as
/// classes de falha.

export type ConnectorFailureAction =
  | 'reconnect'
  | 'pairing'
  | 'update'
  | 'retry'
  | 'paused'
  | 'disconnect'
  | 'support'

export type ConnectorFailure = {
  message: string
  /// Rótulo do botão principal. Diz a saída, não o estado.
  actionLabel: string
  action: ConnectorFailureAction
}

/// Estes três conjuntos têm de ser idênticos aos de
/// `apps/keeprone-connect/lib/failure.ts`. Comentário recíproco não garante
/// nada: quem garante é `connector-failure-parity.test.ts`, que importa os dois
/// módulos e compara os conjuntos.
export const RECONNECT_CODES: readonly string[] = ['DEVICE_REVOKED', 'DEVICE_KEY_UNAVAILABLE']

/// A tentativa de conectar é que falhou — este computador nunca chegou a estar
/// conectado. Dizer "você foi desconectado" seria falso, e oferecer "reconectar"
/// mandaria o agente repetir exatamente o passo que acabou de falhar, com o
/// mesmo texto e o mesmo botão: o laço de novo, uma classe adiante.
export const PAIRING_CODES: readonly string[] = ['PAIRING_REJECTED', 'PAIRING_FAILED']

export const OUTDATED_CODES: readonly string[] = [
  'UNKNOWN_CAPABILITY',
  'UNSAFE_NAVIGATE_PATH',
  'INVALID_RUN_RESPONSE',
  'PATH_NOT_ALLOWED',
  // 426 Upgrade Required. O servidor afirmou o piso; não é dedução nossa.
  'CLIENT_TOO_OLD',
]

/// O conector foi desligado pelo servidor — a alavanca de emergência que não
/// depende de release nenhum. Precisa de classe própria: cair no texto genérico
/// ofereceria "Try again", que dispara um sync que o servidor vai recusar de
/// novo, e o agente ficaria batendo numa porta que sabemos estar fechada.
export const PAUSED_CODES: readonly string[] = ['CONNECTOR_PAUSED']

export const RATE_LIMIT_CODES: readonly string[] = ['RUN_START_RATE_LIMITED']

export const RECONCILIATION_CODES: readonly string[] = [
  'STAGE_INCOMPLETE',
  'STAGE_TRUNCATED',
  'SYNC_INCOMPLETE',
]

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

export function connectorFailureRequiresReconnect(code: string | null | undefined): boolean {
  return typeof code === 'string' && RECONNECT_CODES.includes(code)
}

/// Desconectar não é sincronizar. Sem classe própria, a falha caía no texto
/// genérico de sync e o botão passava a oferecer "Try again", que dispararia um
/// sync — o oposto do que o agente tinha pedido.
export const DISCONNECT_FAILED = 'DISCONNECT_FAILED'

export function connectorFailure(code: string | null | undefined): ConnectorFailure {
  if (connectorFailureRequiresReconnect(code)) {
    return {
      action: 'reconnect',
      actionLabel: 'Reconnect this computer',
      message:
        'This computer is no longer connected to your Keepr One account. Reconnect it to sync again — you will sign in to National Life as usual.',
    }
  }
  if (typeof code === 'string' && PAIRING_CODES.includes(code)) {
    return {
      action: 'pairing',
      actionLabel: 'Start over',
      message:
        'We could not finish connecting this computer. Starting over gets you a fresh connection — if it fails again, contact Keepr One support.',
    }
  }
  if (code === DISCONNECT_FAILED) {
    return {
      action: 'disconnect',
      actionLabel: 'Try disconnecting again',
      message:
        'We could not disconnect this computer just now. Nothing changed — try again, and your data stays exactly as it is.',
    }
  }
  if (typeof code === 'string' && OUTDATED_CODES.includes(code)) {
    return {
      action: 'update',
      actionLabel: "I've updated it — try again",
      message:
        'Keepr One is newer than the KeeproneConnect extension on this computer. Update the extension in your browser, then try again.',
    }
  }
  if (typeof code === 'string' && PAUSED_CODES.includes(code)) {
    return {
      action: 'paused',
      // Não é "tente de novo": tentar de novo bate na mesma recusa. O rótulo diz
      // a única coisa que muda a situação, que é o tempo.
      actionLabel: 'Check again',
      message:
        'Syncing with National Life is paused by Keepr One right now. Nothing is wrong with this computer and nothing was lost — check back shortly.',
    }
  }
  if (typeof code === 'string' && RATE_LIMIT_CODES.includes(code)) {
    return {
      action: 'retry',
      actionLabel: 'Try again in a few minutes',
      message:
        'Too many sync attempts were started in a short period. Your connection is still intact — wait a few minutes, then start the sync once.',
    }
  }
  if (typeof code === 'string' && RECONCILIATION_CODES.includes(code)) {
    return {
      action: 'retry',
      actionLabel: 'Resume sync',
      message:
        'National Life stopped before this area was fully received. Saved batches are safe — resume the sync to collect the missing rows.',
    }
  }
  if (typeof code === 'string' && PORTAL_CODES.includes(code)) {
    return {
      action: 'retry',
      actionLabel: 'Try again',
      message:
        'National Life did not respond while we were reading your data. This usually clears up on its own — wait a minute and try again.',
    }
  }
  return {
    action: 'support',
    actionLabel: 'Try again',
    message:
      'Your sync stopped before it finished. Nothing was lost — try again. If it keeps happening, contact Keepr One support.',
  }
}
