'use client'

export type ConnectorResponse = {
  ok: boolean
  error?: string
  status?: string
  deviceId?: string
  documentId?: string
  commandId?: string
  device?: { status?: string; deviceId?: string }
  sync?: {
    runId?: string
    status?: string
    errorCode?: string
    uploads?: number
    stageIndex?: number
    stageKey?: string
    totalStages?: number
  }
  command?: {
    commandId?: string
    status?: string
    errorCode?: string
    updatedAt?: string
  }
}

type ConnectorMessage =
  | { type: 'START_NATIONAL_LIFE_SYNC'; forceRefresh?: true }
  | { type: 'FETCH_NATIONAL_LIFE_DOCUMENT'; reportRowId: string }
  | { type: 'START_NATIONAL_LIFE_COMMAND'; commandId: string }
  | { type: 'GET_CONNECTOR_STATUS' }
  | { type: 'UNPAIR_CONNECTOR' }
  | { type: 'PAIR_CONNECTOR'; code: string; label: string; baseUrl: string }

type ChromeRuntime = {
  lastError?: { message?: string }
  sendMessage: (
    extensionId: string,
    message: ConnectorMessage,
    callback: (response?: ConnectorResponse) => void,
  ) => void
}

function chromeRuntime(): ChromeRuntime | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as typeof window & { chrome?: { runtime?: ChromeRuntime } }).chrome
    ?.runtime
  return candidate && typeof candidate.sendMessage === 'function' ? candidate : null
}

export function hasConnectorRuntime(): boolean {
  return chromeRuntime() !== null
}

function extensionIds(extensionTarget: string): string[] {
  return [...new Set(extensionTarget.split(',').map((value) => value.trim()).filter(Boolean))]
}

function sendConnectorMessageToExtension(
  extensionId: string,
  message: ConnectorMessage,
  timeoutMs = 5_000,
): Promise<ConnectorResponse> {
  return new Promise((resolve, reject) => {
    const runtime = chromeRuntime()
    if (!runtime) {
      reject(new Error('CONNECTOR_UNAVAILABLE'))
      return
    }
    let settled = false
    const timer = window.setTimeout(() => {
      settled = true
      reject(new Error('CONNECTOR_TIMEOUT'))
    }, timeoutMs)

    try {
      runtime.sendMessage(extensionId, message, (response) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        if (runtime.lastError || !response || typeof response.ok !== 'boolean') {
          reject(new Error('CONNECTOR_UNAVAILABLE'))
          return
        }
        resolve(response)
      })
    } catch {
      window.clearTimeout(timer)
      reject(new Error('CONNECTOR_UNAVAILABLE'))
    }
  })
}

/// Store and unpacked builds can coexist during a controlled rollout. Try the
/// Store ID first, then the still-paired pilot build; both are configuration
/// allowlisted before reaching this client helper.
export async function sendConnectorMessage(
  extensionTarget: string,
  message: ConnectorMessage,
  timeoutMs = 5_000,
): Promise<ConnectorResponse> {
  let lastError: unknown = new Error('CONNECTOR_UNAVAILABLE')
  for (const extensionId of extensionIds(extensionTarget)) {
    try {
      return await sendConnectorMessageToExtension(extensionId, message, timeoutMs)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
