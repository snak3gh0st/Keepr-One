import { requireAllowedBaseUrl } from './constants'
import { CONNECTOR_VERSION_HEADER, readExtensionVersion } from './contract'
import { isConnectorCapability } from './command-contract'

/// O batimento, do lado do cliente.
///
/// Não é a autoridade e não pretende ser: quem recusa trabalho são os endpoints,
/// por conta própria, e um cliente que ignorasse tudo aqui não ganharia nada. Isto
/// existe para duas coisas honestas — não começar trabalho que já sabemos que o
/// servidor vai recusar, e o popup poder dizer "pausado" em vez de "erro".
///
/// Sem `chrome.alarms`: adicionar a permissão é mudança de manifesto, o que a
/// própria restrição do trabalho proíbe (e custaria uma revisão da Web Store, que
/// é exatamente a latência que estamos tentando evitar). Então o batimento é
/// oportunista: reconferimos ao subir o worker e antes de agir, com um TTL que o
/// servidor escolhe. Latência real = a menor entre o TTL e a próxima ação do
/// agente — e nenhuma janela ociosa faz mal, porque parado ninguém sincroniza.
const CONFIG_KEY = 'remoteConfig'
const CONFIG_PATH = '/api/agent/integrations/national-life/local-connector/client-config'
const DEFAULT_HEARTBEAT_SECONDS = 300
const MIN_HEARTBEAT_SECONDS = 60
const MAX_HEARTBEAT_SECONDS = 3600

export type ConnectorRemoteConfig = {
  syncEnabled: boolean
  disabledCapabilities: readonly string[]
  commandProtocolVersion: number
  executableCapabilities: readonly string[]
  minClientVersion: string | null
  heartbeatSeconds: number
}

export type CachedRemoteConfig = ConnectorRemoteConfig & { fetchedAt: number }

/// O padrão é permissivo de propósito. Um servidor inalcançável não pode virar
/// pausa: falha de rede pararia o conector com a frase errada ("pausado pela
/// Keepr One") num momento em que ninguém pausou nada. A pausa só vale quando o
/// servidor a afirma — e os endpoints a afirmam sozinhos de qualquer jeito.
export const PERMISSIVE_REMOTE_CONFIG: ConnectorRemoteConfig = {
  syncEnabled: true,
  disabledCapabilities: [],
  commandProtocolVersion: 1,
  executableCapabilities: ['READ_GRID', 'READ_PAGE', 'READ_EXPORT'],
  minClientVersion: null,
  heartbeatSeconds: DEFAULT_HEARTBEAT_SECONDS,
}

export function parseRemoteConfig(value: unknown): ConnectorRemoteConfig {
  if (typeof value !== 'object' || value === null) return PERMISSIVE_REMOTE_CONFIG
  const raw = value as Record<string, unknown>
  const heartbeat = Number(raw.heartbeatSeconds)
  return {
    // Só o booleano exato `false` pausa. Um campo ausente ou de outro tipo é uma
    // resposta que não entendemos, e não entender não é motivo para parar.
    syncEnabled: raw.syncEnabled !== false,
    disabledCapabilities: Array.isArray(raw.disabledCapabilities)
      ? raw.disabledCapabilities.filter(
          (entry): entry is string => typeof entry === 'string' && /^[A-Z_]{1,64}$/.test(entry),
        )
      : [],
    // Unknown protocol versions are not executable by this release. We retain
    // version 1 locally so the caller uses its closed capability subset.
    commandProtocolVersion:
      typeof raw.commandProtocolVersion === 'number' && raw.commandProtocolVersion === 1
        ? raw.commandProtocolVersion
        : 1,
    executableCapabilities: Array.isArray(raw.executableCapabilities)
      ? raw.executableCapabilities.filter(isConnectorCapability)
      : PERMISSIVE_REMOTE_CONFIG.executableCapabilities,
    minClientVersion:
      typeof raw.minClientVersion === 'string' &&
      /^[0-9]+(\.[0-9]+){0,3}$/.test(raw.minClientVersion)
        ? raw.minClientVersion
        : null,
    heartbeatSeconds: Number.isSafeInteger(heartbeat)
      ? Math.min(MAX_HEARTBEAT_SECONDS, Math.max(MIN_HEARTBEAT_SECONDS, heartbeat))
      : DEFAULT_HEARTBEAT_SECONDS,
  }
}

export function isRemoteConfigStale(cached: CachedRemoteConfig | undefined, now: number): boolean {
  if (!cached) return true
  const age = now - cached.fetchedAt
  // Idade negativa = relógio andou para trás. Tratar como velho é o lado seguro:
  // reconferir custa uma requisição, confiar num cache de idade desconhecida não.
  return age < 0 || age >= cached.heartbeatSeconds * 1000
}

export async function readCachedRemoteConfig(): Promise<CachedRemoteConfig | undefined> {
  const result = await chrome.storage.local.get(CONFIG_KEY)
  const value = result[CONFIG_KEY] as CachedRemoteConfig | undefined
  if (!value || typeof value.fetchedAt !== 'number') return undefined
  return { ...parseRemoteConfig(value), fetchedAt: value.fetchedAt }
}

export async function fetchRemoteConfig(baseUrl: string): Promise<ConnectorRemoteConfig> {
  const origin = requireAllowedBaseUrl(baseUrl)
  const version = readExtensionVersion()
  const response = await fetch(`${origin}${CONFIG_PATH}`, {
    method: 'GET',
    headers: version ? { [CONNECTOR_VERSION_HEADER]: version } : {},
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) throw new Error('REMOTE_CONFIG_UNAVAILABLE')
  return parseRemoteConfig(await response.json())
}

/// Devolve sempre uma configuração utilizável. Se o batimento falhar, o cache
/// serve; se não houver cache, o padrão permissivo serve — porque a recusa de
/// verdade vive no endpoint, e não depender disto aqui é o que torna seguro
/// falhar aberto.
export async function ensureFreshRemoteConfig(
  baseUrl: string | undefined,
  now: number = Date.now(),
): Promise<ConnectorRemoteConfig> {
  const cached = await readCachedRemoteConfig()
  if (!baseUrl) return cached ?? PERMISSIVE_REMOTE_CONFIG
  if (!isRemoteConfigStale(cached, now)) return cached!
  try {
    const fresh = await fetchRemoteConfig(baseUrl)
    await chrome.storage.local.set({ [CONFIG_KEY]: { ...fresh, fetchedAt: now } })
    return fresh
  } catch {
    return cached ?? PERMISSIVE_REMOTE_CONFIG
  }
}
