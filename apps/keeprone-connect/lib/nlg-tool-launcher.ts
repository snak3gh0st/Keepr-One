const TOKEN = /^[A-Za-z0-9_-]{32,128}$/

export const NLG_TOOLS_PATH = '/agent/tools/business-tools/national-life-tools'
export const NLG_IGO_EAPP_PATH = '/agent/sso/igo-eapp'

export type OpenIgoEAppMessage = {
  type: 'OPEN_IGO_EAPP_FROM_TOOLS'
  token: string
  correlationId: string
}

export type OpenIgoEAppResponse = {
  ok: true
  type: 'IGO_EAPP_OPENED_FROM_TOOLS'
  token: string
  correlationId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseOpenIgoEAppMessage(value: unknown): OpenIgoEAppMessage | null {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'correlationId,token,type' ||
    value.type !== 'OPEN_IGO_EAPP_FROM_TOOLS' || typeof value.token !== 'string' ||
    typeof value.correlationId !== 'string' || !TOKEN.test(value.token) ||
    !TOKEN.test(value.correlationId)) return null
  return value as OpenIgoEAppMessage
}

export function parseOpenIgoEAppResponse(
  value: unknown,
  expected: Pick<OpenIgoEAppMessage, 'token' | 'correlationId'>,
): OpenIgoEAppResponse {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'correlationId,ok,token,type' ||
    value.ok !== true || value.type !== 'IGO_EAPP_OPENED_FROM_TOOLS' ||
    value.token !== expected.token || value.correlationId !== expected.correlationId) {
    throw new Error('IGO_TOOL_LAUNCH_RESPONSE_INVALID')
  }
  return value as OpenIgoEAppResponse
}

export function exactIgoEAppHref(currentHref: string, hrefs: readonly string[]): string {
  const current = new URL(currentHref)
  if (current.origin !== 'https://www.nationallife.com' || current.pathname !== NLG_TOOLS_PATH) {
    throw new Error('IGO_TOOL_LAUNCH_PATH_INVALID')
  }
  const matches = hrefs.filter((href) => {
    try {
      const target = new URL(href, current.origin)
      return target.origin === current.origin && target.pathname === NLG_IGO_EAPP_PATH &&
        target.search === '' && target.hash === ''
    } catch {
      return false
    }
  })
  if (matches.length !== 1) throw new Error('IGO_TOOL_LINK_UNAVAILABLE')
  return matches[0]!
}
