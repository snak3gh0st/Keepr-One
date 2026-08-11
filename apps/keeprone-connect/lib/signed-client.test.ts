import { describe, expect, it } from 'vitest'
import {
  base64Url,
  canonicalMessage,
  classifyFailedResponse,
  sha256,
  signCanonicalMessage,
} from './signed-client'

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)).buffer as ArrayBuffer
}

describe('signed device requests', () => {
  it('builds the exact canonical message', () => {
    expect(
      canonicalMessage({
        method: 'put',
        pathname: '/api/example',
        jti: 'request-id',
        timestamp: '2026-08-04T19:00:00.000Z',
        bodyHash: 'abc',
      }),
    ).toBe('PUT\n/api/example\nrequest-id\n2026-08-04T19:00:00.000Z\nabc')
  })

  it('hashes UTF-8 bodies as lowercase SHA-256 hex', async () => {
    expect(await sha256('{}')).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
  })

  it('creates a base64url P-256 signature that verifies', async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    const message = 'POST\n/api/test\njti\n2026-08-04T19:00:00.000Z\nhash'
    const encoded = await signCanonicalMessage(pair.privateKey, message)
    expect(encoded).toBe(base64Url(fromBase64Url(encoded)))
    await expect(
      crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.publicKey,
        fromBase64Url(encoded),
        new TextEncoder().encode(message),
      ),
    ).resolves.toBe(true)
  })
})

describe('classifyFailedResponse', () => {
  it('calls it a revocation only when the server says so explicitly', () => {
    expect(
      classifyFailedResponse(401, new Headers({ 'x-fyntra-device-error': 'DEVICE_REVOKED' })),
    ).toBe('DEVICE_REVOKED')
  })

  it('does not invent a revocation from a bare 401', () => {
    // Pode ser só relógio adiantado. Chamar isso de revogação faz o chamador
    // apagar a chave de um dispositivo saudável — e o desvio sobrevive ao
    // repareamento, então o laço volta.
    expect(classifyFailedResponse(401, new Headers())).toBe('DEVICE_REQUEST_REJECTED')
    expect(
      classifyFailedResponse(401, new Headers({ 'x-fyntra-device-error': 'INVALID_DEVICE_SIGNATURE' })),
    ).toBe('DEVICE_REQUEST_REJECTED')
  })

  it('leaves every other status as a plain failure', () => {
    expect(classifyFailedResponse(500, new Headers())).toBe('DEVICE_REQUEST_FAILED')
    expect(classifyFailedResponse(403, new Headers())).toBe('DEVICE_REQUEST_FAILED')
  })

  it('keeps a run-start rate limit distinct from a portal failure', () => {
    expect(classifyFailedResponse(429, new Headers({ 'retry-after': '120' })))
      .toBe('RUN_START_RATE_LIMITED')
  })
})
