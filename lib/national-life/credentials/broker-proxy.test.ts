import { describe, expect, it, vi } from 'vitest'
import { proxyCredentialBrokerRequest } from './broker-proxy'

const path = '/api/agent/integrations/national-life/local-connector/credential-leases'

function request(body = '{"sentinel":true}') {
  return new Request(`https://keeprone.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'must-not-forward',
      authorization: 'must-not-forward',
      'x-fyntra-connector-version': '0.1.56',
      'x-fyntra-device-id': 'device_1',
      'x-fyntra-jti': 'jti_1234567890123456',
      'x-fyntra-timestamp': '2026-09-01T18:00:00.000Z',
      'x-fyntra-body-sha256': 'a'.repeat(64),
      'x-fyntra-signature': 'b'.repeat(86),
      'x-not-allowed': 'must-not-forward',
    },
    body,
  })
}

describe('credential broker private proxy', () => {
  it('forwards exact bytes/path and only the closed header allowlist', async () => {
    const fetch = vi.fn(async (...args: [string | URL | Request, RequestInit?]) => {
      void args
      return new Response(
        '{"schemaVersion":1,"leaseId":"lease_1"}',
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'set-cookie': 'must-not-return',
            'x-internal': 'must-not-return',
          },
        },
      )
    })
    const response = await proxyCredentialBrokerRequest(request(), {
      brokerUrl: 'http://kbot-credential-broker:3020', fetch,
      createTimeoutSignal: () => new AbortController().signal,
    })

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe(`http://kbot-credential-broker:3020${path}`)
    expect(init?.method).toBe('POST')
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe('{"sentinel":true}')
    const headers = new Headers(init?.headers)
    expect(Object.fromEntries(headers)).toEqual({
      'content-type': 'application/json',
      'x-fyntra-body-sha256': 'a'.repeat(64),
      'x-fyntra-connector-version': '0.1.56',
      'x-fyntra-device-id': 'device_1',
      'x-fyntra-jti': 'jti_1234567890123456',
      'x-fyntra-signature': 'b'.repeat(86),
      'x-fyntra-timestamp': '2026-09-01T18:00:00.000Z',
    })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-internal')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('fails closed for an unavailable broker and never performs local decryption', async () => {
    const decrypt = vi.fn()
    const response = await proxyCredentialBrokerRequest(request(), {
      brokerUrl: 'http://kbot-credential-broker:3020',
      fetch: vi.fn().mockRejectedValue(new Error('private network detail')),
      createTimeoutSignal: () => new AbortController().signal,
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'CREDENTIAL_BROKER_UNAVAILABLE' })
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('caps both request and broker response bytes and refuses redirects', async () => {
    const fetch = vi.fn(async () => new Response('x'.repeat(16 * 1_024 + 1)))
    let response = await proxyCredentialBrokerRequest(request('x'.repeat(2_049)), {
      brokerUrl: 'http://kbot-credential-broker:3020', fetch,
      createTimeoutSignal: () => new AbortController().signal,
    })
    expect(response.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()

    response = await proxyCredentialBrokerRequest(request(), {
      brokerUrl: 'http://kbot-credential-broker:3020', fetch,
      createTimeoutSignal: () => new AbortController().signal,
    })
    expect(response.status).toBe(503)

    const redirectFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      throw new TypeError('redirect mode is error')
    })
    response = await proxyCredentialBrokerRequest(request(), {
      brokerUrl: 'http://kbot-credential-broker:3020', fetch: redirectFetch,
      createTimeoutSignal: () => new AbortController().signal,
    })
    expect(response.status).toBe(503)
  })
})
