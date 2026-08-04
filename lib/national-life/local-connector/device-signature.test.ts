import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_CONNECTOR_SIGNATURE_HEADERS,
  canonicalDeviceMessage,
  sha256Hex,
  verifyLocalConnectorDeviceRequest,
} from './device-signature'

let keyPair: CryptoKeyPair
let publicKeyJwk: JsonWebKey

beforeAll(async () => {
  keyPair = (await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  publicKeyJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)
})

async function signedRequest(body: Uint8Array, pathname = '/api/local/runs') {
  const timestamp = '2026-08-04T18:00:00.000Z'
  const jti = 'request-id-00000001'
  const bodyHash = sha256Hex(body)
  const message = canonicalDeviceMessage({
    method: 'POST',
    pathname,
    jti,
    timestamp,
    bodyHash,
  })
  const signature = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(message),
  )
  return new Headers({
    [LOCAL_CONNECTOR_SIGNATURE_HEADERS.deviceId]: 'device-1',
    [LOCAL_CONNECTOR_SIGNATURE_HEADERS.jti]: jti,
    [LOCAL_CONNECTOR_SIGNATURE_HEADERS.timestamp]: timestamp,
    [LOCAL_CONNECTOR_SIGNATURE_HEADERS.bodyHash]: bodyHash,
    [LOCAL_CONNECTOR_SIGNATURE_HEADERS.signature]: Buffer.from(signature).toString('base64url'),
  })
}

function signatureDb() {
  const seen = new Set<string>()
  const replayCreate = vi.fn(async ({ data }: { data: { jti: string } }) => {
    if (seen.has(data.jti)) throw { code: 'P2002' }
    seen.add(data.jti)
    return {}
  })
  const tx = {
    nationalLifeConnectorReplay: { create: replayCreate },
    nationalLifeConnectorDevice: { update: vi.fn().mockResolvedValue({}) },
  }
  return {
    db: {
      nationalLifeConnectorDevice: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'device-1',
          agentId: 'agent-1',
          publicKeyJwk,
        }),
      },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never,
    replayCreate,
  }
}

describe('local connector device signatures', () => {
  it('verifies the canonical request and records replay before returning', async () => {
    const body = new TextEncoder().encode('{}')
    const headers = await signedRequest(body)
    const { db, replayCreate } = signatureDb()

    await expect(
      verifyLocalConnectorDeviceRequest(db, {
        method: 'POST',
        pathname: '/api/local/runs',
        headers,
        body,
        now: new Date('2026-08-04T18:01:00.000Z'),
      }),
    ).resolves.toEqual({
      deviceId: 'device-1',
      agentId: 'agent-1',
      jti: 'request-id-00000001',
    })
    expect(replayCreate).toHaveBeenCalledOnce()
  })

  it('rejects replayed jti values and body tampering', async () => {
    const body = new TextEncoder().encode('{}')
    const headers = await signedRequest(body)
    const { db } = signatureDb()
    const input = {
      method: 'POST',
      pathname: '/api/local/runs',
      headers,
      body,
      now: new Date('2026-08-04T18:01:00.000Z'),
    }

    await verifyLocalConnectorDeviceRequest(db, input)
    await expect(verifyLocalConnectorDeviceRequest(db, input)).rejects.toThrow(
      'INVALID_DEVICE_SIGNATURE',
    )
    await expect(
      verifyLocalConnectorDeviceRequest(db, {
        ...input,
        body: new TextEncoder().encode('{"changed":true}'),
      }),
    ).rejects.toThrow('INVALID_DEVICE_SIGNATURE')
  })
})
