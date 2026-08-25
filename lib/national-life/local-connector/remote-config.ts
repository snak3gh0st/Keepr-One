import 'server-only'
import type { LocalConnectorCapabilityName } from './capabilities'
import { isConnectorCapability } from '../connector-command-contract'

/// Alavancas que o servidor detém sobre extensões já instaladas.
///
/// O problema que este módulo existe para resolver: quando o servidor muda, as
/// extensões instaladas continuam rodando código velho, e não há nada que acelere
/// isso. O Chrome checa atualização a cada 5h (`kDefaultUpdateFrequency`) e
/// `chrome.runtime.requestUpdateCheck()` cai no mesmo backoff de 5h, que só zera
/// quando uma atualização de verdade instala — é um empurrão, não um acelerador.
/// Pior: o Chrome só *instala* com o service worker ocioso, e o nosso acorda o
/// tempo todo, então ele adia a própria atualização até o navegador reiniciar.
/// Planeje em dias. Rollout percentual da Web Store exige >10.000 usuários
/// semanais (temos ~100), e rollback entrega ao código v(n-1) os dados escritos
/// pela v(n).
///
/// Portanto: a emergência tem de ser uma *flag*, não um release. Tudo aqui é
/// variável de ambiente lida a cada requisição — latência de um deploy de
/// configuração (minutos), não de uma publicação na Store (dias). Sem fornecedor
/// novo, sem dependência nova.
export const LOCAL_CONNECTOR_VERSION_HEADER = 'x-fyntra-connector-version'

/// Cabeçalho que distingue "pausamos de propósito" de "o servidor caiu". Sem ele
/// um 503 é indistinguível de rede ruim e o agente lê "tente de novo" para sempre.
export const LOCAL_CONNECTOR_STATE_HEADER = 'x-fyntra-connector-state'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const VERSION_PATTERN = /^[0-9]+(\.[0-9]+){0,3}$/
const DEFAULT_HEARTBEAT_SECONDS = 300
const MIN_HEARTBEAT_SECONDS = 60
const MAX_HEARTBEAT_SECONDS = 3600
/// Version 0.1.2 added the explicit stage-complete acknowledgement. Older
/// builds have no final request after their last chunk, so the server keeps a
/// narrowly-scoped compatibility path until the release is fully installed.
const STAGE_COMPLETION_PROTOCOL_VERSION = [0, 1, 2, 0]
const EXPORT_PROTOCOL_VERSION = [0, 1, 15, 0]
export const COMMISSION_DETAIL_PROTOCOL_MIN_VERSION = '0.1.18'
const COMMISSION_DETAIL_PROTOCOL_VERSION = [0, 1, 18, 0]

export type LocalConnectorRemoteConfig = {
  /// `false` derruba o conector inteiro sem tocar na extensão. É o botão vermelho.
  syncEnabled: boolean
  /// Capacidades desligadas individualmente. Mais cirúrgico que o botão vermelho.
  disabledCapabilities: readonly LocalConnectorCapabilityName[]
  /// Abaixo disto o servidor recusa com 426. `null` = sem piso (padrão).
  minClientVersion: string | null
  /// De quanto em quanto tempo a extensão deve reconferir esta configuração.
  heartbeatSeconds: number
}

/// Comparação de versão de quatro campos, sem semver de biblioteca — a restrição
/// é não adicionar dependência, e a versão de manifesto do Chrome já é
/// exatamente isto: até quatro inteiros separados por ponto.
export function parseConnectorVersion(value: string | null | undefined): number[] | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length > 32 || !VERSION_PATTERN.test(trimmed)) return null
  const parts = trimmed.split('.').map(Number)
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0 || part > 65_535)) return null
  while (parts.length < 4) parts.push(0)
  return parts
}

export function compareConnectorVersions(left: number[], right: number[]): number {
  for (let index = 0; index < 4; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

export function supportsStageCompletionProtocol(headers: Pick<Headers, 'get'>): boolean {
  const reported = parseConnectorVersion(headers.get(LOCAL_CONNECTOR_VERSION_HEADER))
  return reported !== null && compareConnectorVersions(reported, STAGE_COMPLETION_PROTOCOL_VERSION) >= 0
}

export function supportsExportProtocol(headers: Pick<Headers, 'get'>): boolean {
  const reported = parseConnectorVersion(headers.get(LOCAL_CONNECTOR_VERSION_HEADER))
  return reported !== null && compareConnectorVersions(reported, EXPORT_PROTOCOL_VERSION) >= 0
}

/// Version 0.1.18 added the per-statement commission-detail plan and its durable
/// cursor. Every priority run includes that stage, even when READ_PAGE is off,
/// so accepting an older client would create a run it cannot parse or finish.
export function supportsCommissionDetailProtocol(headers: Pick<Headers, 'get'>): boolean {
  const reported = parseConnectorVersion(headers.get(LOCAL_CONNECTOR_VERSION_HEADER))
  return reported !== null &&
    compareConnectorVersions(reported, COMMISSION_DETAIL_PROTOCOL_VERSION) >= 0
}

/// Auto-declarada e não confiável: qualquer cliente pode mentir o número. Serve
/// como sinal de UX e de operação (saber o que existe instalado lá fora), nunca
/// como controle de segurança. O que de fato não pode rodar num cliente velho é
/// recusado pelo próprio endpoint, por autoridade dele — ver
/// `enforceLocalConnectorClientFloor`, que é um *piso*, e o kill switch, que não
/// consulta a versão nenhuma.
export function readReportedClientVersion(headers: Pick<Headers, 'get'>): string | null {
  const raw = headers.get(LOCAL_CONNECTOR_VERSION_HEADER)
  return parseConnectorVersion(raw) ? raw!.trim() : null
}

function parseDisabledCapabilities(value: string | undefined): LocalConnectorCapabilityName[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is LocalConnectorCapabilityName => isConnectorCapability(entry))
}

function parseMinClientVersion(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (!parseConnectorVersion(trimmed)) {
    throw new Error(
      'NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION must be a dotted version such as 0.2.0',
    )
  }
  return trimmed
}

function parseHeartbeatSeconds(value: string | undefined): number {
  const parsed = Number(value?.trim() || DEFAULT_HEARTBEAT_SECONDS)
  if (!Number.isSafeInteger(parsed)) return DEFAULT_HEARTBEAT_SECONDS
  return Math.min(MAX_HEARTBEAT_SECONDS, Math.max(MIN_HEARTBEAT_SECONDS, parsed))
}

export function getLocalConnectorRemoteConfig(): LocalConnectorRemoteConfig {
  return {
    // Pausa é opt-in e explícita: só a string exata liga o botão vermelho, para
    // que um valor digitado errado não derrube o conector por acidente.
    syncEnabled: process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_PAUSED?.trim() !== 'true',
    disabledCapabilities: parseDisabledCapabilities(
      process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_DISABLED_CAPABILITIES,
    ),
    minClientVersion: parseMinClientVersion(
      process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION,
    ),
    heartbeatSeconds: parseHeartbeatSeconds(
      process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_HEARTBEAT_SECONDS,
    ),
  }
}

export function isCapabilityDisabled(
  capability: LocalConnectorCapabilityName,
  config: LocalConnectorRemoteConfig = getLocalConnectorRemoteConfig(),
): boolean {
  return config.disabledCapabilities.includes(capability)
}

/// 426 Upgrade Required: status próprio, que o cliente distingue sem ler corpo.
/// Um 400 ou um 401 aqui seria lido como "requisição malformada" ou "dispositivo
/// recusado" e mandaria o agente reconectar — o passo que não resolve nada.
export function localConnectorUpgradeRequiredResponse(minVersion: string): Response {
  return Response.json(
    { error: 'CLIENT_TOO_OLD', minVersion },
    { status: 426, headers: NO_STORE },
  )
}

export function localConnectorPausedResponse(): Response {
  return Response.json(
    { error: 'CONNECTOR_PAUSED' },
    { status: 503, headers: { ...NO_STORE, [LOCAL_CONNECTOR_STATE_HEADER]: 'PAUSED' } },
  )
}

/// Piso de versão, decidido pelo servidor.
///
/// Sem piso configurado nada é recusado — o padrão preserva o piloto atual, onde
/// a distribuição é unpacked e ninguém carimba versão. Com piso configurado, a
/// ausência do cabeçalho também é recusa: um cliente velho demais para se
/// identificar é exatamente o que o piso existe para barrar.
export function enforceLocalConnectorClientFloor(
  headers: Pick<Headers, 'get'>,
  config: LocalConnectorRemoteConfig = getLocalConnectorRemoteConfig(),
): Response | null {
  const floor = parseConnectorVersion(config.minClientVersion)
  if (!floor || !config.minClientVersion) return null
  const reported = parseConnectorVersion(headers.get(LOCAL_CONNECTOR_VERSION_HEADER))
  if (!reported || compareConnectorVersions(reported, floor) < 0) {
    return localConnectorUpgradeRequiredResponse(config.minClientVersion)
  }
  return null
}

/// Recusa por autoridade do endpoint, antes de qualquer trabalho.
///
/// Kill switch primeiro: pausar não depende de o cliente ter dito a versão dele,
/// e um cliente velho durante uma pausa deve ler "pausado", não "atualize" — a
/// atualização não o desbloquearia.
export function refuseLocalConnectorRequest(
  headers: Pick<Headers, 'get'>,
  config: LocalConnectorRemoteConfig = getLocalConnectorRemoteConfig(),
): Response | null {
  if (!config.syncEnabled) return localConnectorPausedResponse()
  return enforceLocalConnectorClientFloor(headers, config)
}

/// Mesma recusa, um degrau mais fino: desligar `READ_GRID` derruba a leitura de
/// grades sem derrubar pareamento nem o encerramento de runs abertos. Do ponto de
/// vista do agente é a mesma frase — "pausado" —, porque a saída dele é a mesma:
/// esperar. Quem precisa da distinção é quem opera, e essa está na configuração.
export function refuseLocalConnectorCapability(
  capability: LocalConnectorCapabilityName,
  headers: Pick<Headers, 'get'>,
  config: LocalConnectorRemoteConfig = getLocalConnectorRemoteConfig(),
): Response | null {
  if (isCapabilityDisabled(capability, config)) return localConnectorPausedResponse()
  return refuseLocalConnectorRequest(headers, config)
}
