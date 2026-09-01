import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  CredentialVaultError,
  createVaultTransitDecryptClient,
  createVaultTransitEncryptClient,
  type VaultTransitDependencies,
} from './vault-transit'

const binding = {
  agentId: 'agent-1',
  formatVersion: 1,
  provider: 'NATIONAL_LIFE',
  purpose: 'PORTAL_CREDENTIAL',
} as const

const clientConfig = {
  vaultAddress: 'https://vault.example.com',
  mount: 'transit',
  key: 'kbot-national-life',
  tokenFile: '/run/secrets/vault-token',
} as const

function response(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type VaultFetch = NonNullable<VaultTransitDependencies['fetch']>

function mockFetch(implementation: VaultFetch) {
  return vi.fn(implementation)
}

function deps(fetchMock: ReturnType<typeof mockFetch>) {
  return {
    fetch: fetchMock,
    readTokenFile: vi.fn(async () => 'vault-token-from-sink\n'),
    createTimeoutSignal: vi.fn(() => new AbortController().signal),
  }
}

describe('Vault Transit credential boundary', () => {
  it('encrypts canonical credential JSON with bound context and no redirects', async () => {
    const fetchMock = mockFetch(async () => response({
      data: { ciphertext: 'vault:v7:ciphertext' },
    }))
    const dependencies = deps(fetchMock)
    const encrypt = createVaultTransitEncryptClient(clientConfig, dependencies)

    const stored = await encrypt.encrypt({
      plaintext: {
        formatVersion: 1,
        username: 'agent',
        password: 'sentinel-password',
      },
      binding,
    })

    expect(stored).toEqual({
      encryptionProvider: 'VAULT_TRANSIT',
      formatVersion: 1,
      keyVersion: 'v7',
      encryptedPayload: 'vault:v7:ciphertext',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://vault.example.com/v1/transit/encrypt/kbot-national-life',
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    )
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(Buffer.from(request.plaintext, 'base64').toString()).toBe(
      '{"formatVersion":1,"password":"sentinel-password","username":"agent"}',
    )
    expect(Buffer.from(request.context, 'base64').toString()).toBe(
      '{"agentId":"agent-1","formatVersion":1,"provider":"NATIONAL_LIFE","purpose":"PORTAL_CREDENTIAL"}',
    )
    expect(request.context).toBe(request.associated_data)
    expect(dependencies.readTokenFile).toHaveBeenCalledWith('/run/secrets/vault-token')
    expect(dependencies.createTimeoutSignal).toHaveBeenCalledWith(3_000)
  })

  it('reads the token sink again for every request', async () => {
    const fetchMock = mockFetch(async () => response({
      data: { ciphertext: 'vault:v1:ciphertext' },
    }))
    const dependencies = deps(fetchMock)
    const encrypt = createVaultTransitEncryptClient(clientConfig, dependencies)
    const input = {
      plaintext: { formatVersion: 1 as const, username: 'agent', password: 'sentinel-password' },
      binding,
    }

    await encrypt.encrypt(input)
    await encrypt.encrypt(input)

    expect(dependencies.readTokenFile).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['redirect', response({}, 302), 'VAULT_REJECTED'],
    ['malformed JSON', response('not-json'), 'VAULT_PAYLOAD_INVALID'],
    ['malformed ciphertext', response({ data: { ciphertext: 'ciphertext' } }), 'VAULT_PAYLOAD_INVALID'],
  ] as const)('collapses %s without leaking request data', async (_name, vaultResponse, code) => {
    const fetchMock = mockFetch(async () => vaultResponse)
    const encrypt = createVaultTransitEncryptClient(clientConfig, deps(fetchMock))

    let thrown: unknown
    try {
      await encrypt.encrypt({
        plaintext: { formatVersion: 1, username: 'agent', password: 'sentinel-password' },
        binding,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CredentialVaultError)
    expect(thrown).toMatchObject({ code })
    expect(String(thrown)).not.toContain('sentinel-password')
  })

  it('maps timeout and network failures to VAULT_UNAVAILABLE', async () => {
    const fetchMock = mockFetch(async () => {
      throw new DOMException('provider timeout with internal details', 'AbortError')
    })
    const encrypt = createVaultTransitEncryptClient(clientConfig, deps(fetchMock))

    await expect(encrypt.encrypt({
      plaintext: { formatVersion: 1, username: 'agent', password: 'sentinel-password' },
      binding,
    })).rejects.toMatchObject({ code: 'VAULT_UNAVAILABLE' })
  })

  it('decrypts and strictly validates the credential payload', async () => {
    const plaintext = Buffer.from(
      '{"formatVersion":1,"password":"sentinel-password","username":"agent"}',
    ).toString('base64')
    const fetchMock = mockFetch(async () => response({ data: { plaintext } }))
    const decrypt = createVaultTransitDecryptClient(clientConfig, deps(fetchMock))

    const result = await decrypt.decrypt({
      stored: {
        encryptionProvider: 'VAULT_TRANSIT',
        formatVersion: 1,
        keyVersion: 'v7',
        encryptedPayload: 'vault:v7:ciphertext',
      },
      binding,
    })

    expect(result).toEqual({
      formatVersion: 1,
      username: 'agent',
      password: 'sentinel-password',
    })
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(request).toMatchObject({ ciphertext: 'vault:v7:ciphertext' })
    expect(request.context).toBe(request.associated_data)
  })

  it('rejects malformed base64 plaintext and binding rejection safely', async () => {
    const malformed = createVaultTransitDecryptClient(clientConfig, deps(
      mockFetch(async () => response({ data: { plaintext: '%%%' } })),
    ))
    await expect(malformed.decrypt({
      stored: {
        encryptionProvider: 'VAULT_TRANSIT', formatVersion: 1, keyVersion: 'v1',
        encryptedPayload: 'vault:v1:ciphertext',
      },
      binding,
    })).rejects.toMatchObject({ code: 'VAULT_PAYLOAD_INVALID' })

    const mismatch = createVaultTransitDecryptClient(clientConfig, deps(
      mockFetch(async () => response({}, 400)),
    ))
    await expect(mismatch.decrypt({
      stored: {
        encryptionProvider: 'VAULT_TRANSIT', formatVersion: 1, keyVersion: 'v1',
        encryptedPayload: 'vault:v1:ciphertext',
      },
      binding: { ...binding, agentId: 'agent-2' },
    })).rejects.toMatchObject({ code: 'VAULT_REJECTED' })
  })
})
