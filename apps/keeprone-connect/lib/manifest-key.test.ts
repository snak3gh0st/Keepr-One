import { describe, expect, it } from 'vitest'
import { extensionIdFromManifestKey, normalizeManifestKey } from './manifest-key'

describe('manifest key normalization', () => {
  it('removes PEM whitespace so Chrome receives one Base64 value', () => {
    expect(normalizeManifestKey('MIIBIjAN\nBgkqhkiG9w0B\r\nAQEAA')).toBe('MIIBIjANBgkqhkiG9w0BAQEAA')
  })

  it('derives the Chrome extension identity from the manifest public key', () => {
    expect(extensionIdFromManifestKey('aGVs\nbG8=')).toBe('cmpcenlkfplakdaocgoidlckmfljocjo')
  })
})
