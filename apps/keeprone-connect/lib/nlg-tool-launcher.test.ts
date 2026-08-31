import { describe, expect, it } from 'vitest'
import {
  exactIgoEAppHref,
  parseOpenIgoEAppMessage,
  parseOpenIgoEAppResponse,
} from './nlg-tool-launcher'

describe('National Life iGO tool launcher contract', () => {
  const request = {
    type: 'OPEN_IGO_EAPP_FROM_TOOLS',
    token: 't'.repeat(32),
    correlationId: 'c'.repeat(32),
  } as const

  it('accepts only the exact correlated launch message and response', () => {
    expect(parseOpenIgoEAppMessage(request)).toEqual(request)
    expect(parseOpenIgoEAppMessage({ ...request, extra: true })).toBeNull()
    expect(parseOpenIgoEAppResponse({
      ok: true,
      type: 'IGO_EAPP_OPENED_FROM_TOOLS',
      token: request.token,
      correlationId: request.correlationId,
    }, request)).toMatchObject({ ok: true, type: 'IGO_EAPP_OPENED_FROM_TOOLS' })
  })

  it('selects exactly one official iGO button only from National Life Tools', () => {
    expect(exactIgoEAppHref(
      'https://www.nationallife.com/agent/tools/business-tools/national-life-tools',
      ['/agent/sso/foresight', '/agent/sso/igo-eapp'],
    )).toBe('/agent/sso/igo-eapp')
    expect(() => exactIgoEAppHref(
      'https://www.nationallife.com/agent/',
      ['/agent/sso/igo-eapp'],
    )).toThrow('IGO_TOOL_LAUNCH_PATH_INVALID')
    expect(() => exactIgoEAppHref(
      'https://www.nationallife.com/agent/tools/business-tools/national-life-tools',
      ['/agent/sso/igo-eapp', 'https://www.nationallife.com/agent/sso/igo-eapp'],
    )).toThrow('IGO_TOOL_LINK_UNAVAILABLE')
  })
})
