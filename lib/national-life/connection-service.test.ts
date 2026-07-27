import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptCredential } from './credential-crypto'
import {
  deleteAgentCredential,
  getAgentConnectionSummary,
  saveAgentCredential,
  type ConnectionSummary,
  type CredentialRepository,
  type StoredCredentialInput,
} from './connection-service'

const activeKey = {
  version: 'v-test',
  base64Key: randomBytes(32).toString('base64'),
}

class InMemoryCredentialRepository implements CredentialRepository {
  writes: StoredCredentialInput[] = []
  deleteCalls: Array<{ agentId: string; provider: string }> = []
  private readonly summaries = new Map<string, ConnectionSummary>()

  async upsert(input: StoredCredentialInput): Promise<void> {
    this.writes.push(input)
    this.summaries.set(`${input.agentId}:${input.provider}`, {
      provider: input.provider,
      maskedUsername: input.maskedUsername,
      status: input.status,
      lastTestedAt: input.lastTestedAt ?? null,
      lastSucceededAt: input.lastSucceededAt ?? null,
      updatedAt: input.updatedAt,
    })
  }

  async delete(agentId: string, provider: string): Promise<void> {
    this.deleteCalls.push({ agentId, provider })
    this.summaries.delete(`${agentId}:${provider}`)
  }

  async findSummary(agentId: string, provider: string): Promise<ConnectionSummary | null> {
    return this.summaries.get(`${agentId}:${provider}`) ?? null
  }
}

describe('National Life connection service', () => {
  it('encrypts and stores only masked identity plus ciphertext', async () => {
    const repository = new InMemoryCredentialRepository()

    await saveAgentCredential(
      {
        agentId: 'agent-1',
        scopeId: 'fyntra-production',
        username: 'producer@example.com',
        password: 'very-secret',
      },
      { repository, activeKey },
    )

    expect(repository.writes).toHaveLength(1)
    expect(repository.writes[0]).toMatchObject({
      agentId: 'agent-1',
      provider: 'NATIONAL_LIFE',
      maskedUsername: 'p***@example.com',
      keyVersion: activeKey.version,
      algorithm: 'aes-256-gcm',
      status: 'UNTESTED',
    })
    expect(repository.writes[0]).not.toHaveProperty('username')
    expect(repository.writes[0]).not.toHaveProperty('password')
    expect(repository.writes[0].ciphertext).not.toContain('producer@example.com')
    expect(repository.writes[0].ciphertext).not.toContain('very-secret')
  })

  it('binds encryption context to the owning agent', async () => {
    const repository = new InMemoryCredentialRepository()

    await saveAgentCredential(
      {
        agentId: 'agent-1',
        scopeId: 'fyntra-production',
        username: 'producer',
        password: 'very-secret',
      },
      { repository, activeKey },
    )

    const stored = repository.writes[0]

    expect(
      decryptCredential(
        {
          algorithm: 'aes-256-gcm',
          keyVersion: stored.keyVersion,
          iv: stored.iv,
          ciphertext: stored.ciphertext,
          authTag: stored.authTag,
        },
        { agentId: 'agent-1', scopeId: 'fyntra-production', provider: 'NATIONAL_LIFE' },
        { [activeKey.version]: activeKey.base64Key },
      ),
    ).toEqual({
      username: 'producer',
      password: 'very-secret',
    })

    expect(() =>
      decryptCredential(
        {
          algorithm: 'aes-256-gcm',
          keyVersion: stored.keyVersion,
          iv: stored.iv,
          ciphertext: stored.ciphertext,
          authTag: stored.authTag,
        },
        { agentId: 'agent-2', scopeId: 'fyntra-production', provider: 'NATIONAL_LIFE' },
        { [activeKey.version]: activeKey.base64Key },
      ),
    ).toThrow()
  })

  it('deletes only the exact agent/provider connection', async () => {
    const repository = new InMemoryCredentialRepository()

    await deleteAgentCredential(
      {
        agentId: 'agent-9',
        provider: 'NATIONAL_LIFE',
      },
      { repository, activeKey },
    )

    expect(repository.deleteCalls).toEqual([{ agentId: 'agent-9', provider: 'NATIONAL_LIFE' }])
  })

  it('never returns ciphertext or plaintext in the connection summary', async () => {
    const repository = new InMemoryCredentialRepository()

    await saveAgentCredential(
      {
        agentId: 'agent-1',
        scopeId: 'fyntra-production',
        username: 'producer@example.com',
        password: 'very-secret',
      },
      { repository, activeKey },
    )

    const summary = await getAgentConnectionSummary('agent-1', { repository, activeKey })

    expect(summary).toEqual({
      provider: 'NATIONAL_LIFE',
      maskedUsername: 'p***@example.com',
      status: 'UNTESTED',
      lastTestedAt: null,
      lastSucceededAt: null,
      updatedAt: expect.any(Date),
    })
    expect(summary).not.toHaveProperty('ciphertext')
    expect(summary).not.toHaveProperty('password')
    expect(summary).not.toHaveProperty('username')
  })
})
