import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ proxy: vi.fn() }))
vi.mock('@/lib/national-life/credentials/broker-proxy', () => ({
  proxyCredentialBrokerRequest: mocks.proxy,
}))

import { POST } from './route'

describe('public credential lease proxy route', () => {
  it('forwards the original request without cookie authentication', async () => {
    const request = new Request('https://keeprone.test/api/agent/integrations/national-life/local-connector/credential-leases', {
      method: 'POST', body: '{}',
    })
    mocks.proxy.mockResolvedValue(new Response('{}', { status: 200 }))
    await expect(POST(request)).resolves.toMatchObject({ status: 200 })
    expect(mocks.proxy).toHaveBeenCalledWith(request)
  })
})
