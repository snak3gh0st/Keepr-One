const DATABASE = 'keeprone-connect'
const STORE = 'keys'
const PRIVATE_KEY_ID = 'device-private-key'
const PUBLIC_KEY_ID = 'device-public-jwk'
const CREDENTIAL_PRIVATE_KEY_ID = 'credential-private-key'
const CREDENTIAL_PUBLIC_KEY_ID = 'credential-public-jwk'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('KEYSTORE_UNAVAILABLE'))
  })
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = operation(database.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('KEYSTORE_UNAVAILABLE'))
    })
  } finally {
    database.close()
  }
}

export async function readPrivateKey(): Promise<CryptoKey | null> {
  return (await transaction('readonly', (store) => store.get(PRIVATE_KEY_ID))) ?? null
}

export async function writePrivateKey(key: CryptoKey): Promise<void> {
  if (key.extractable || key.type !== 'private' || !key.usages.includes('sign')) {
    throw new Error('INVALID_PRIVATE_KEY')
  }
  await transaction('readwrite', (store) => store.put(key, PRIVATE_KEY_ID))
}

export async function readCredentialDecryptionKey(): Promise<CryptoKey | null> {
  return (await transaction(
    'readonly',
    (store) => store.get(CREDENTIAL_PRIVATE_KEY_ID),
  )) ?? null
}

async function writeCredentialDecryptionKey(key: CryptoKey): Promise<void> {
  if (key.extractable || key.type !== 'private' || !key.usages.includes('decrypt')) {
    throw new Error('INVALID_CREDENTIAL_PRIVATE_KEY')
  }
  await transaction('readwrite', (store) => store.put(key, CREDENTIAL_PRIVATE_KEY_ID))
}

export async function clearDeviceKeys(): Promise<void> {
  await transaction('readwrite', (store) => store.clear())
}

export async function getOrCreateDeviceKey(): Promise<JsonWebKey> {
  const existing = await readPrivateKey()
  if (existing) {
    const publicJwk = await transaction<JsonWebKey | undefined>(
      'readonly',
      (store) => store.get(PUBLIC_KEY_ID),
    )
    if (!publicJwk) throw new Error('PUBLIC_KEY_UNAVAILABLE')
    return publicJwk
  }
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  if (pair.privateKey.extractable) throw new Error('PRIVATE_KEY_EXTRACTABLE')
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const normalized = { ...publicKeyJwk, alg: 'ES256', use: 'sig', key_ops: ['verify'], ext: true }
  await writePrivateKey(pair.privateKey)
  await transaction('readwrite', (store) => store.put(normalized, PUBLIC_KEY_ID))
  return normalized
}

let credentialKeyCreation: Promise<JsonWebKey> | undefined

async function createOrReadCredentialEncryptionKey(): Promise<JsonWebKey> {
  const existing = await readCredentialDecryptionKey()
  if (existing) {
    const publicJwk = await transaction<JsonWebKey | undefined>(
      'readonly',
      (store) => store.get(CREDENTIAL_PUBLIC_KEY_ID),
    )
    if (!publicJwk) throw new Error('CREDENTIAL_PUBLIC_KEY_UNAVAILABLE')
    return publicJwk
  }

  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair
  if (pair.privateKey.extractable) throw new Error('CREDENTIAL_PRIVATE_KEY_EXTRACTABLE')
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
  if (exported.kty !== 'RSA' || !exported.n || exported.e !== 'AQAB') {
    throw new Error('CREDENTIAL_PUBLIC_KEY_INVALID')
  }
  const normalized: JsonWebKey = {
    kty: 'RSA',
    alg: 'RSA-OAEP-256',
    use: 'enc',
    key_ops: ['encrypt'],
    ext: true,
    e: exported.e,
    n: exported.n,
  }
  await writeCredentialDecryptionKey(pair.privateKey)
  await transaction('readwrite', (store) => store.put(normalized, CREDENTIAL_PUBLIC_KEY_ID))
  return normalized
}

export function getOrCreateCredentialEncryptionKey(): Promise<JsonWebKey> {
  if (!credentialKeyCreation) {
    credentialKeyCreation = createOrReadCredentialEncryptionKey().finally(() => {
      credentialKeyCreation = undefined
    })
  }
  return credentialKeyCreation
}

export async function rotateDeviceKey(): Promise<JsonWebKey> {
  await clearDeviceKeys()
  return getOrCreateDeviceKey()
}
