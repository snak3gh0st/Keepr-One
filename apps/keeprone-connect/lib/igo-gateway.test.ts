import { describe, expect, it } from 'vitest'
import {
  classifyIgoProbe,
  classifyIgoSurface,
  parseIgoProbeMessage,
  parseIgoProbeResponse,
} from './igo-gateway'

describe('iGO read-only gateway probe', () => {
  it('separates browser blocking, network, login, MFA and a successful landing', () => {
    expect(classifyIgoProbe({ url: 'https://pipepasstoigo.ipipeline.com', online: true, browserError: 'net::ERR_BLOCKED_BY_CLIENT' })).toBe('GATEWAY_BLOCKED_BY_CLIENT')
    expect(classifyIgoProbe({ url: 'https://pipepasstoigo.ipipeline.com', online: false })).toBe('GATEWAY_NO_NETWORK')
    expect(classifyIgoProbe({ url: 'https://nlg-prod.auth0.com/login', online: true })).toBe('AUTH_REQUIRED')
    expect(classifyIgoProbe({ url: 'https://nlg-prod.auth0.com/mfa', online: true })).toBe('MFA_REQUIRED')
    expect(classifyIgoProbe({ url: 'https://igoforms2.ipipeline.com/start', online: true })).toBe('IGO_READY')
    expect(classifyIgoProbe({ url: 'https://unexpected.example/start', online: true })).toBe('UNEXPECTED_ORIGIN')
  })

  it('recognizes safe surfaces without collecting fields or URL session material', () => {
    expect(classifyIgoSurface({ bodyText: 'Start New Case View My Cases', formCount: 0 })).toBe('IGO_HOME')
    expect(classifyIgoSurface({ bodyText: 'Case List Folder List', formCount: 0 })).toBe('IGO_CASE_LIST')
    expect(classifyIgoSurface({ bodyText: 'Applicant Information', formCount: 1 })).toBe('IGO_FORM')
  })

  it('accepts only a minimal correlated probe message', () => {
    const message = { type: 'PROBE_IGO_SURFACE', token: 't'.repeat(32), correlationId: 'c'.repeat(16) }
    expect(parseIgoProbeMessage(message)).toEqual(message)
    expect(parseIgoProbeMessage({ ...message, save: true })).toBeNull()
  })

  it('accepts only the correlated, value-free surface receipt', () => {
    const request = { type: 'PROBE_IGO_SURFACE' as const, token: 't'.repeat(32), correlationId: 'c'.repeat(16) }
    const response = {
      ok: true, type: 'IGO_SURFACE_PROBED', token: request.token,
      correlationId: request.correlationId, surface: 'IGO_HOME',
    }
    expect(parseIgoProbeResponse(response, request)).toEqual(response)
    expect(parseIgoProbeResponse({ ...response, url: 'https://igoforms2.ipipeline.com/?token=secret' }, request)).toBeNull()
    expect(parseIgoProbeResponse({ ...response, correlationId: 'x'.repeat(16) }, request)).toBeNull()
  })
})
