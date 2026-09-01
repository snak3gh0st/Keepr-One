import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDeviceKeys,
  getOrCreateCredentialEncryptionKey,
  getOrCreateDeviceKey,
  readCredentialDecryptionKey,
  readPrivateKey,
} from './key-store'

function fakeIndexedDb(): IDBFactory {
  const values = new Map<IDBValidKey, unknown>()
  let initialized = false

  const request = <T>(operation: () => T) => {
    const result = {} as IDBRequest<T>
    queueMicrotask(() => {
      try {
        Object.defineProperty(result, 'result', { value: operation(), configurable: true })
        result.onsuccess?.(new Event('success') as Event & { target: IDBRequest<T> })
      } catch (error) {
        Object.defineProperty(result, 'error', { value: error, configurable: true })
        result.onerror?.(new Event('error') as Event & { target: IDBRequest<T> })
      }
    })
    return result
  }

  const store = {
    get: (key: IDBValidKey) => request(() => values.get(key)),
    put: (value: unknown, key: IDBValidKey) => request(() => {
      values.set(key, value)
      return key
    }),
    clear: () => request(() => {
      values.clear()
      return undefined
    }),
  } as unknown as IDBObjectStore
  const database = {
    objectStoreNames: { contains: () => initialized },
    createObjectStore: () => {
      initialized = true
      return store
    },
    transaction: () => ({ objectStore: () => store }),
    close: vi.fn(),
  } as unknown as IDBDatabase

  return {
    open: () => {
      const openRequest = {} as IDBOpenDBRequest
      queueMicrotask(() => {
        Object.defineProperty(openRequest, 'result', { value: database, configurable: true })
        if (!initialized) openRequest.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
        openRequest.onsuccess?.(new Event('success') as Event & { target: IDBOpenDBRequest })
      })
      return openRequest
    },
  } as unknown as IDBFactory
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', fakeIndexedDb())
  vi.stubGlobal('crypto', webcrypto)
})

describe('K-Bot device key store', () => {
  it('persists one non-extractable RSA-OAEP decryption key', async () => {
    const first = await getOrCreateCredentialEncryptionKey()
    const second = await getOrCreateCredentialEncryptionKey()
    const privateKey = await readCredentialDecryptionKey()

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      kty: 'RSA', alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'], ext: true,
    })
    expect(first).not.toHaveProperty('d')
    expect(privateKey).toMatchObject({ extractable: false, type: 'private' })
    expect(privateKey?.usages).toEqual(['decrypt'])
  })

  it('clears signing and credential encryption identities together', async () => {
    await getOrCreateDeviceKey()
    await getOrCreateCredentialEncryptionKey()

    await clearDeviceKeys()

    expect(await readPrivateKey()).toBeNull()
    expect(await readCredentialDecryptionKey()).toBeNull()
  })
})
