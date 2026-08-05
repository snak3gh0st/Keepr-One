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

export type ConnectorFailureAction = 'reconnect' | 'update' | 'retry' | 'support'

export type ConnectorFailure = {
  message: string
  /// Rótulo do botão principal. Diz a saída, não o estado.
  actionLabel: string
  action: ConnectorFailureAction
}

const REVOKING_CODES: readonly string[] = [
  'DEVICE_REVOKED',
  'DEVICE_REQUEST_REJECTED',
  'DEVICE_KEY_UNAVAILABLE',
  'PAIRING_REJECTED',
]

const OUTDATED_CODES: readonly string[] = [
  'UNKNOWN_CAPABILITY',
  'UNSAFE_NAVIGATE_PATH',
  'INVALID_RUN_RESPONSE',
  'PATH_NOT_ALLOWED',
]

const PORTAL_CODES: readonly string[] = [
  'PORTAL_REQUEST_FAILED',
  'TEMPLATE_UNAVAILABLE',
  'INVALID_PORTAL_RESPONSE',
  'BRIDGE_UNAVAILABLE',
  'DEVICE_REQUEST_FAILED',
]

export function connectorFailureRequiresReconnect(code: string | null | undefined): boolean {
  return typeof code === 'string' && REVOKING_CODES.includes(code)
}

export function connectorFailure(code: string | null | undefined): ConnectorFailure {
  if (connectorFailureRequiresReconnect(code)) {
    return {
      action: 'reconnect',
      actionLabel: 'Reconnect this computer',
      message:
        'This computer is no longer connected to your Keepr One account. Reconnect it to sync again — you will sign in to National Life as usual.',
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
