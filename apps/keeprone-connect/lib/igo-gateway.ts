import { classifyIgoLocation } from './igo-origin'

export type IgoProbeState =
  | 'AUTH_REQUIRED'
  | 'MFA_REQUIRED'
  | 'GATEWAY_BLOCKED_BY_CLIENT'
  | 'GATEWAY_NO_NETWORK'
  | 'GATEWAY_IN_PROGRESS'
  | 'IGO_READY'
  | 'UNEXPECTED_ORIGIN'

export type IgoSurface = 'IGO_HOME' | 'IGO_CASE_LIST' | 'IGO_FORM' | 'IGO_UNKNOWN'

export type IgoSurfaceProbeMessage = {
  type: 'PROBE_IGO_SURFACE'
  token: string
  correlationId: string
}

export type IgoSurfaceProbeResponse = {
  ok: true
  type: 'IGO_SURFACE_PROBED'
  token: string
  correlationId: string
  surface: IgoSurface
}

export function classifyIgoProbe(input: {
  url: string
  online: boolean
  browserError?: string | null
}): IgoProbeState {
  if (input.browserError === 'net::ERR_BLOCKED_BY_CLIENT' || input.browserError === 'ERR_BLOCKED_BY_CLIENT') {
    return 'GATEWAY_BLOCKED_BY_CLIENT'
  }
  if (!input.online || input.browserError === 'net::ERR_INTERNET_DISCONNECTED' ||
    input.browserError === 'net::ERR_NAME_NOT_RESOLVED') return 'GATEWAY_NO_NETWORK'
  switch (classifyIgoLocation(input.url)) {
    case 'AUTH_REQUIRED': return 'AUTH_REQUIRED'
    case 'MFA_REQUIRED': return 'MFA_REQUIRED'
    case 'NATIONAL_LIFE_LAUNCHER':
    case 'IPIPELINE_GATEWAY':
    case 'IPIPELINE_FEDERATION': return 'GATEWAY_IN_PROGRESS'
    case 'IGO_FORMS': return 'IGO_READY'
    default: return 'UNEXPECTED_ORIGIN'
  }
}

export function classifyIgoSurface(input: { bodyText: string; formCount: number }): IgoSurface {
  const text = input.bodyText.replace(/\s+/g, ' ').trim()
  if (/Start New Case/i.test(text) && /View My Cases/i.test(text)) return 'IGO_HOME'
  if (/Case List|Folder List|Unsaved Cases List/i.test(text)) return 'IGO_CASE_LIST'
  if (input.formCount > 0 && /Insured|Applicant|Application/i.test(text)) return 'IGO_FORM'
  return 'IGO_UNKNOWN'
}

export function parseIgoProbeMessage(value: unknown): IgoSurfaceProbeMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const message = value as Record<string, unknown>
  const keys = Object.keys(message).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['correlationId', 'token', 'type']) ||
    message.type !== 'PROBE_IGO_SURFACE' || typeof message.token !== 'string' ||
    message.token.length < 32 || message.token.length > 128 ||
    typeof message.correlationId !== 'string' || message.correlationId.length < 16 ||
    message.correlationId.length > 128) return null
  return message as IgoSurfaceProbeMessage
}

export function parseIgoProbeResponse(
  value: unknown,
  request: IgoSurfaceProbeMessage,
): IgoSurfaceProbeResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const response = value as Record<string, unknown>
  const keys = Object.keys(response).sort()
  if (JSON.stringify(keys) !== JSON.stringify([
    'correlationId', 'ok', 'surface', 'token', 'type',
  ]) || response.ok !== true || response.type !== 'IGO_SURFACE_PROBED' ||
    response.token !== request.token || response.correlationId !== request.correlationId ||
    !['IGO_HOME', 'IGO_CASE_LIST', 'IGO_FORM', 'IGO_UNKNOWN'].includes(String(response.surface))) {
    return null
  }
  return response as IgoSurfaceProbeResponse
}
