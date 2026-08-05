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

export type ConnectorFailureAction = 'reconnect' | 'update' | 'retry' | 'disconnect' | 'support'

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
export const RECONNECT_CODES: readonly string[] = [
  'DEVICE_REVOKED',
  'DEVICE_KEY_UNAVAILABLE',
  'PAIRING_REJECTED',
]

export const OUTDATED_CODES: readonly string[] = [
  'UNKNOWN_CAPABILITY',
  'UNSAFE_NAVIGATE_PATH',
  'INVALID_RUN_RESPONSE',
  'PATH_NOT_ALLOWED',
]

export const PORTAL_CODES: readonly string[] = [
  'PORTAL_REQUEST_FAILED',
  'TEMPLATE_UNAVAILABLE',
  'INVALID_PORTAL_RESPONSE',
  'BRIDGE_UNAVAILABLE',
  'DEVICE_REQUEST_FAILED',
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
