/// Classificação de falhas do KeeproneConnect.
///
/// Um código interno nunca chega ao agente: ele é apenas a chave que escolhe a
/// frase. O par (mensagem, ação) é o contrato — toda falha precisa dizer o que
/// fazer a seguir, e `support` é fallback de verdade, não o caso comum.
///
/// A página web tem o seu próprio mapa em
/// `lib/national-life/local-connector/connector-failure.ts`. São superfícies
/// diferentes (popup de uma linha vs. cartão com botão), por isso o texto é
/// escrito duas vezes de propósito; as classes de falha é que são as mesmas.

export type ConnectorFailureAction = 'reconnect' | 'signin' | 'retry' | 'update' | 'support'

export type ConnectorFailure = {
  message: string
  action: ConnectorFailureAction
}

/// Marca local de "o servidor não reconhece mais este dispositivo". Só existe
/// para que o motivo sobreviva à limpeza do pareamento.
export const DEVICE_REVOKED = 'DEVICE_REVOKED'

/// Credenciais mortas. Repetir a mesma requisição assinada não pode dar certo,
/// então o pareamento local tem de sair do caminho e dar lugar a reconectar.
const REVOKING_CODES: readonly string[] = [
  DEVICE_REVOKED,
  'DEVICE_REQUEST_REJECTED',
  'DEVICE_KEY_UNAVAILABLE',
]

/// O servidor mandou um plano que esta versão da extensão não sabe executar.
const OUTDATED_CODES: readonly string[] = [
  'UNKNOWN_CAPABILITY',
  'UNSAFE_NAVIGATE_PATH',
  'INVALID_RUN_RESPONSE',
  'PATH_NOT_ALLOWED',
]

/// O portal (ou a ponte com ele) não respondeu como esperado. Costuma passar.
const PORTAL_CODES: readonly string[] = [
  'PORTAL_REQUEST_FAILED',
  'TEMPLATE_UNAVAILABLE',
  'INVALID_PORTAL_RESPONSE',
  'BRIDGE_UNAVAILABLE',
  'DEVICE_REQUEST_FAILED',
]

export function revokesDevice(code: string | undefined | null): boolean {
  return typeof code === 'string' && REVOKING_CODES.includes(code)
}

export function connectorFailure(code: string | undefined | null): ConnectorFailure {
  if (revokesDevice(code)) {
    return {
      action: 'reconnect',
      message:
        'This computer is no longer linked to your Keepr One account. Reconnect it from the National Life page in Keepr One.',
    }
  }
  if (typeof code === 'string' && OUTDATED_CODES.includes(code)) {
    return {
      action: 'update',
      message:
        'This browser extension is out of date. Update KeeproneConnect in your browser, then start the sync again.',
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
