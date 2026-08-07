/// O contrato que esta versão da extensão fala com o servidor.
///
/// Fica num módulo sem acesso a `chrome` de propósito: `schema-version-parity.test.ts`,
/// do lado do servidor, importa esta constante e prova que ela é membro do conjunto
/// aceito. Enquanto o número estava embutido no corpo do upload em `background.ts`,
/// nada ligava os dois lados — a divergência só apareceria como 400 no dispositivo
/// de um agente.
export const CONNECTOR_SCHEMA_VERSION = 2

/// Cabeçalho que a extensão carimba em toda requisição. É auto-declarado, logo
/// não vale como controle de segurança: serve para o servidor saber o que está
/// instalado lá fora e para poder recusar cliente velho com um status próprio.
export const CONNECTOR_VERSION_HEADER = 'x-fyntra-connector-version'

/// `chrome.runtime.getManifest` não existe fora do navegador (testes, e qualquer
/// contexto onde a API ainda não subiu). Ler a versão nunca pode derrubar o
/// caminho de assinatura: sem versão, o cabeçalho simplesmente não vai.
export function readExtensionVersion(): string | undefined {
  try {
    // Structural, not `typeof chrome`: this module is also type-checked from the
    // root project, which does not load the extension's browser type definitions.
    const runtime = (
      globalThis as { chrome?: { runtime?: { getManifest?: () => { version?: unknown } } } }
    ).chrome?.runtime
    const version = runtime?.getManifest?.().version
    return typeof version === 'string' && /^[0-9]+(\.[0-9]+){0,3}$/.test(version)
      ? version
      : undefined
  } catch {
    return undefined
  }
}
