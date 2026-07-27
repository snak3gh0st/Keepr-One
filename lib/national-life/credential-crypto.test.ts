import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptCredential, encryptCredential } from './credential-crypto'

const key = randomBytes(32).toString('base64')
const context = { agentId: 'agent-1', scopeId: 'fyntra-production', provider: 'NATIONAL_LIFE' }

describe('National Life credential encryption', () => {
  it('round trips only with matching authenticated context', () => {
    const encrypted = encryptCredential({ username: 'producer', password: 'secret' }, context, {
      version: 'v1',
      base64Key: key,
    })
    expect(decryptCredential(encrypted, context, { v1: key })).toEqual({
      username: 'producer',
      password: 'secret',
    })
  })

  it('rejects ciphertext rebound to another agent', () => {
    const encrypted = encryptCredential({ username: 'producer', password: 'secret' }, context, {
      version: 'v1',
      base64Key: key,
    })
    expect(() =>
      decryptCredential(encrypted, { ...context, agentId: 'agent-2' }, { v1: key }),
    ).toThrow()
  })
})
