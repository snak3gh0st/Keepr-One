import { describe, expect, it } from 'vitest'
import { createWhatsappClient, type WhatsappHttp } from './whatsapp-client'

function recorder(responses: unknown[], ok = true) {
  const calls: { url: string; init: RequestInit }[] = []
  let i = 0
  const http: WhatsappHttp = async (url, init) => {
    calls.push({ url, init })
    const body = responses[i] ?? {}
    i += 1
    return { ok, status: ok ? 200 : 500, json: async () => body }
  }
  return { http, calls }
}

const config = (http: WhatsappHttp) => ({ baseUrl: 'http://evo:8080', apiKey: 'k', http })

describe('createWhatsappClient', () => {
  it('names the instance after the agent so two agents never share a session', async () => {
    const { http, calls } = recorder([{ instance: { instanceName: 'agent-a1' } }])
    await createWhatsappClient(config(http)).createInstance({ agentId: 'a1' })

    expect(calls[0]?.url).toBe('http://evo:8080/instance/create')
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      instanceName: 'agent-a1',
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    })
  })

  it('authenticates every call with the api key', async () => {
    const { http, calls } = recorder([{}])
    await createWhatsappClient(config(http)).createInstance({ agentId: 'a1' })

    expect((calls[0]?.init.headers as Record<string, string>).apikey).toBe('k')
  })

  it('returns the qr code when the carrier has emitted one', async () => {
    const { http } = recorder([{ base64: 'data:image/png;base64,AAA', code: '2@abc' }])
    const qr = await createWhatsappClient(config(http)).fetchQrCode({ agentId: 'a1' })

    expect(qr).toEqual({ image: 'data:image/png;base64,AAA' })
  })

  it('reports "not ready" rather than inventing a qr that does not exist', async () => {
    // Evolution answers `{count: 0}` while the session is still starting. Treating
    // that as a failure would tell the agent it broke when it is merely early.
    const { http } = recorder([{ count: 0 }])
    const qr = await createWhatsappClient(config(http)).fetchQrCode({ agentId: 'a1' })

    expect(qr).toBeNull()
  })

  it('reads the connection state', async () => {
    const { http } = recorder([{ instance: { state: 'open' } }])
    const state = await createWhatsappClient(config(http)).connectionState({ agentId: 'a1' })

    expect(state).toBe('open')
  })

  it('raises a typed error when the provider refuses', async () => {
    const { http } = recorder([{}], false)

    await expect(
      createWhatsappClient(config(http)).createInstance({ agentId: 'a1' }),
    ).rejects.toThrow('WHATSAPP_REQUEST_FAILED')
  })
})
