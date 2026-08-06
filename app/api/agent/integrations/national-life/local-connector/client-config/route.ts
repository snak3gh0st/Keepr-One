import { getNationalLifeLocalConnectorConfig } from '@/lib/national-life/local-connector/config'
import {
  getLocalConnectorRemoteConfig,
  readReportedClientVersion,
} from '@/lib/national-life/local-connector/remote-config'

const NO_STORE = { 'Cache-Control': 'no-store' }

/// O batimento. A extensão pergunta "ainda posso trabalhar?" e recebe a resposta
/// da configuração corrente do servidor — latência de um deploy de env (minutos),
/// não de uma publicação na Chrome Web Store (dias).
///
/// Três decisões que parecem detalhe e não são:
///
/// 1. Responde 200 mesmo com o conector desligado. Se 404asse junto com o resto do
///    conector, "desligamos de propósito" ficaria indistinguível de "a rede caiu",
///    e o popup não teria como dizer a frase honesta.
/// 2. Não é assinado e não recebe escopo de dispositivo. Não expõe nada que já não
///    esteja na página pública de integração, e ficar fora do caminho de assinatura
///    é o que permite consultá-lo justamente quando o pareamento está quebrado.
/// 3. Não é a autoridade. Quem recusa trabalho são os endpoints de run e de stage,
///    por conta própria. Isto aqui existe para a extensão não começar trabalho
///    condenado e para o popup dizer a verdade — um cliente que ignore esta
///    resposta não ganha nada com isso.
export async function GET(request: Request) {
  const remote = getLocalConnectorRemoteConfig()
  const install = getNationalLifeLocalConnectorConfig()
  // Auto-declarada: só serve para sabermos o que existe instalado na frota.
  const reportedVersion = readReportedClientVersion(request.headers)

  return Response.json(
    {
      syncEnabled: install.enabled && remote.syncEnabled,
      disabledCapabilities: remote.disabledCapabilities,
      minClientVersion: remote.minClientVersion,
      heartbeatSeconds: remote.heartbeatSeconds,
      // Eco do que foi reportado, para a extensão conferir que o cabeçalho chegou
      // inteiro (proxy que remove header é falha silenciosa, senão).
      reportedVersion,
    },
    { status: 200, headers: NO_STORE },
  )
}
