import { createHash } from 'node:crypto'

export function normalizeManifestKey(value: string): string {
  return value.replace(/\s+/g, '')
}

export function extensionIdFromManifestKey(value: string): string {
  const digest = createHash('sha256')
    .update(Buffer.from(normalizeManifestKey(value), 'base64'))
    .digest('hex')
    .slice(0, 32)
  const chromeAlphabet = 'abcdefghijklmnop'
  return [...digest]
    .map((character) => chromeAlphabet[Number.parseInt(character, 16)])
    .join('')
}
