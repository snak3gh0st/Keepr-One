import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendConnectorMessage } from './NationalLifeConnectorClient'

const storeExtensionId = 'anfhdbmapiohhbplmccimflcenijfnoi'
const pilotExtensionId = 'khiifdbaccckngdonfhiloilklnapgoh'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendConnectorMessage', () => {
  it('falls back to the paired pilot when the Store extension is not installed yet', async () => {
    const calls: string[] = []
    const runtime: {
      lastError?: { message?: string }
      sendMessage: (extensionId: string, message: unknown, callback: (response?: { ok: boolean }) => void) => void
    } = {
      sendMessage(extensionId, _message, callback) {
        calls.push(extensionId)
        if (extensionId === storeExtensionId) {
          runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' }
          callback()
          runtime.lastError = undefined
          return
        }
        callback({ ok: true })
      },
    }
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      chrome: { runtime },
    })

    await expect(
      sendConnectorMessage(`${storeExtensionId},${pilotExtensionId}`, { type: 'GET_CONNECTOR_STATUS' }),
    ).resolves.toEqual({ ok: true })
    expect(calls).toEqual([storeExtensionId, pilotExtensionId])
  })
})
