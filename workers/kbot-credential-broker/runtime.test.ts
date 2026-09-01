import { describe, expect, it, vi } from 'vitest'
import { LocalConnectorSignatureError } from '@/lib/national-life/local-connector/device-signature'
import { CredentialLeaseError } from '@/lib/national-life/credentials/lease-service'
import { createKBotCredentialBrokerHandler } from './runtime'

const leasePath = '/api/agent/integrations/national-life/local-connector/credential-leases'

function request(path = leasePath, body: unknown = {
  schemaVersion: 1,
  operation: { kind: 'SYNC_RUN', id: 'run_1' },
  page: {
    origin: 'https://www.nationallife.com', pathname: '/agent/auth/login', classification: 'LOGIN',
  },
}) {
  return new Request(`http://127.0.0.1:3020${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fyntra-device-id': 'device_1' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function dependencies() {
  const order: string[] = []
  const verifyDevice = vi.fn(async () => {
    order.push('signature')
    return { agentId: 'agent_1', deviceId: 'device_1', jti: 'jti_1234567890123456' }
  })
  const issueCredentialLease = vi.fn(async () => {
    order.push('credential-lookup')
    return { schemaVersion: 1, leaseId: 'lease_1' }
  })
  const recordCredentialLeaseOutcome = vi.fn(async () => {
    order.push('result')
    return { leaseId: 'lease_1', outcome: 'AUTHENTICATED' }
  })
  return { verifyDevice, issueCredentialLease, recordCredentialLeaseOutcome, order }
}

describe('K-Bot credential broker runtime', () => {
  it('exposes a minimal health response and only the two POST route shapes', async () => {
    const deps = dependencies()
    const handler = createKBotCredentialBrokerHandler(deps)
    const health = await handler(new Request('http://127.0.0.1:3020/health'))
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true })
    expect(health.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(await (await handler(new Request('http://127.0.0.1:3020/config'))).json()))
      .not.toMatch(/vault|database|redis|token/i)
    expect((await handler(request(`${leasePath}/lease_1`))).status).toBe(404)

    const result = await handler(request(`${leasePath}/lease_1/result`, {
      schemaVersion: 1, outcome: 'AUTHENTICATED',
    }))
    expect(result.status).toBe(200)
    expect(deps.recordCredentialLeaseOutcome).toHaveBeenCalledWith(expect.objectContaining({
      leaseId: 'lease_1', agentId: 'agent_1', deviceId: 'device_1',
    }))
  })

  it('caps request bytes and verifies the signature before credential access', async () => {
    const deps = dependencies()
    const handler = createKBotCredentialBrokerHandler(deps)
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(deps.order).toEqual(['signature', 'credential-lookup'])

    const oversized = await handler(request(leasePath, 'x'.repeat(2_049)))
    expect(oversized.status).toBe(400)
    expect(deps.verifyDevice).toHaveBeenCalledTimes(1)
    expect(deps.issueCredentialLease).toHaveBeenCalledTimes(1)
  })

  it('maps only safe signature and lease failures without logging bodies or headers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const deps = dependencies()
    deps.verifyDevice.mockRejectedValueOnce(new LocalConnectorSignatureError('DEVICE_REVOKED'))
    let response = await createKBotCredentialBrokerHandler(deps)(request())
    expect(response.status).toBe(401)
    expect(response.headers.get('x-fyntra-device-error')).toBe('DEVICE_REVOKED')
    expect(await response.json()).toEqual({ error: 'DEVICE_REQUEST_REJECTED' })

    for (const [error, status] of [
      [new CredentialLeaseError('CREDENTIAL_PAGE_NOT_APPROVED'), 400],
      [new CredentialLeaseError('CREDENTIAL_LEASE_ALREADY_ISSUED'), 409],
      [new CredentialLeaseError('CREDENTIAL_RATE_LIMITED', 37), 429],
      [new CredentialLeaseError('CREDENTIAL_LIMIT_UNAVAILABLE'), 503],
    ] as const) {
      const candidate = dependencies()
      candidate.issueCredentialLease.mockRejectedValueOnce(error)
      response = await createKBotCredentialBrokerHandler(candidate)(request())
      expect(response.status).toBe(status)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(JSON.stringify(await response.json())).not.toMatch(/vault|password|cookie|token/i)
      if (status === 429) expect(response.headers.get('retry-after')).toBe('37')
    }
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
