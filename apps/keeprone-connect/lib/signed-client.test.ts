import { describe, expect, it, vi } from 'vitest'
import {
  base64Url,
  canonicalMessage,
  classifyFailedResponse,
  responseFailureCode,
  retryIdempotentSignedRequest,
  SignedRequestError,
  sha256,
  sha256Bytes,
  signCanonicalMessage,
  termReconciliationFailure,
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

  it('hashes binary export chunks without JSON expansion', async () => {
    expect(await sha256Bytes(new Uint8Array([0, 1, 2, 255])))
      .toBe('3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56')
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

  it('preserves an expired Founder refusal without calling it a revocation', () => {
    expect(
      classifyFailedResponse(
        401,
        new Headers({ 'x-fyntra-device-error': 'FOUNDER_ACCESS_REQUIRED' }),
      ),
    ).toBe('FOUNDER_ACCESS_REQUIRED')
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

describe('responseFailureCode', () => {
  it.each([
    [409, 'CREDENTIAL_NOT_CONFIGURED'],
    [409, 'CREDENTIAL_AUTO_LOGIN_DISABLED'],
    [409, 'CREDENTIAL_LEASE_ALREADY_ISSUED'],
    [409, 'DEVICE_ENCRYPTION_KEY_REQUIRED'],
    [429, 'CREDENTIAL_RATE_LIMITED'],
    [503, 'CREDENTIAL_BROKER_UNAVAILABLE'],
  ] as const)('preserves the safe credential error %s/%s', async (status, error) => {
    await expect(responseFailureCode(new Response(JSON.stringify({ error }), {
      status,
      headers: { 'content-type': 'application/json' },
    }))).resolves.toBe(error)
  })

  it('does not trust arbitrary server error strings', async () => {
    await expect(responseFailureCode(new Response(JSON.stringify({
      error: 'password=must-not-land',
    }), { status: 409 }))).resolves.toBe('IDEMPOTENCY_CONFLICT')
  })
})

describe('Term PDF reconciliation failures', () => {
  it('keeps the server-confirmed parser cause for the command failure record', async () => {
    await expect(termReconciliationFailure(new Response(
      JSON.stringify({ error: 'FORESIGHT_TERM_PREMIUM_MISSING' }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    ))).resolves.toBe('FORESIGHT_TERM_PREMIUM_MISSING')
  })

  it('does not trust arbitrary response bodies as a safe parser cause', async () => {
    await expect(termReconciliationFailure(new Response(
      JSON.stringify({ error: 'DATABASE_ERROR' }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    ))).resolves.toBeNull()
  })
})

describe('retryIdempotentSignedRequest', () => {
  it('retries transient gateway failures and then returns the accepted receipt', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new SignedRequestError('DEVICE_REQUEST_FAILED', 504))
      .mockResolvedValue({ duplicate: false })
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(retryIdempotentSignedRequest({ request, wait, delaysMs: [25, 75] }))
      .resolves.toEqual({ duplicate: false })
    expect(request).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledWith(25)
  })

  it('retries a browser network failure but stops after the configured budget', async () => {
    const failure = new TypeError('Failed to fetch')
    const request = vi.fn().mockRejectedValue(failure)
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(retryIdempotentSignedRequest({ request, wait, delaysMs: [10, 20] }))
      .rejects.toBe(failure)
    expect(request).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls).toEqual([[10], [20]])
  })

  it.each([
    new SignedRequestError('DEVICE_REQUEST_FAILED', 400),
    new SignedRequestError('DEVICE_REQUEST_REJECTED', 401),
    new SignedRequestError('IDEMPOTENCY_CONFLICT', 409),
  ])('does not retry deterministic or security failures (%s)', async (failure) => {
    const request = vi.fn().mockRejectedValue(failure)
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(retryIdempotentSignedRequest({ request, wait, delaysMs: [10, 20] }))
      .rejects.toBe(failure)
    expect(request).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })
})
