import { prisma } from '@/lib/prisma'
import { NATIONAL_LIFE_PROVIDER } from './constants'
import { encryptCredential } from './credential-crypto'

export type ConnectionSummary = {
  provider: string
  maskedUsername: string
  status: string
  lastTestedAt: Date | null
  lastSucceededAt: Date | null
  updatedAt: Date
}

export type StoredCredentialInput = {
  agentId: string
  provider: string
  maskedUsername: string
  keyVersion: string
  algorithm: 'aes-256-gcm'
  iv: string
  ciphertext: string
  authTag: string
  status: string
  lastTestedAt?: Date | null
  lastSucceededAt?: Date | null
  updatedAt: Date
}

export type CredentialRepository = {
  upsert(input: StoredCredentialInput): Promise<void>
  delete(agentId: string, provider: string): Promise<void>
  findSummary(agentId: string, provider: string): Promise<ConnectionSummary | null>
}

export type ConnectionServiceDeps = {
  repository?: CredentialRepository
  activeKey?: { version: string; base64Key: string }
}

const USERNAME_MIN_LENGTH = 1
const USERNAME_MAX_LENGTH = 200
const PASSWORD_MIN_LENGTH = 1
const PASSWORD_MAX_LENGTH = 500

const prismaCredentialRepository: CredentialRepository = {
  async upsert(input) {
    await prisma.agentIntegrationCredential.upsert({
      where: {
        agentId_provider: {
          agentId: input.agentId,
          provider: input.provider,
        },
      },
      create: {
        agentId: input.agentId,
        provider: input.provider,
        maskedUsername: input.maskedUsername,
        keyVersion: input.keyVersion,
        algorithm: input.algorithm,
        iv: input.iv,
        ciphertext: input.ciphertext,
        authTag: input.authTag,
        status: input.status,
        lastTestedAt: input.lastTestedAt ?? null,
        lastSucceededAt: input.lastSucceededAt ?? null,
        updatedAt: input.updatedAt,
      },
      update: {
        maskedUsername: input.maskedUsername,
        keyVersion: input.keyVersion,
        algorithm: input.algorithm,
        iv: input.iv,
        ciphertext: input.ciphertext,
        authTag: input.authTag,
        status: input.status,
        lastTestedAt: input.lastTestedAt ?? null,
        lastSucceededAt: input.lastSucceededAt ?? null,
        updatedAt: input.updatedAt,
      },
    })
  },

  async delete(agentId, provider) {
    await prisma.agentIntegrationCredential.deleteMany({
      where: { agentId, provider },
    })
  },

  async findSummary(agentId, provider) {
    const credential = await prisma.agentIntegrationCredential.findUnique({
      where: {
        agentId_provider: {
          agentId,
          provider,
        },
      },
      select: {
        provider: true,
        maskedUsername: true,
        status: true,
        lastTestedAt: true,
        lastSucceededAt: true,
        updatedAt: true,
      },
    })

    if (!credential) {
      return null
    }

    return credential
  },
}

function resolveRepository(deps?: ConnectionServiceDeps) {
  return deps?.repository ?? prismaCredentialRepository
}

async function resolveActiveKey(deps?: ConnectionServiceDeps) {
  if (deps?.activeKey) {
    return deps.activeKey
  }

  const { getNationalLifeEnv } = await import('./env')
  const env = getNationalLifeEnv()
  return {
    version: env.credentialKeyVersion,
    base64Key: env.credentialKeys[env.credentialKeyVersion],
  }
}

function validateCredentialText(name: string, value: string, minLength: number, maxLength: number) {
  if (value.length < minLength || value.length > maxLength) {
    throw new Error(`${name} must be between ${minLength} and ${maxLength} characters`)
  }
}

function maskUsername(username: string) {
  const firstCharacter = Array.from(username)[0] ?? '*'
  const emailMatch = /^([^@]+)@([^@]+)$/.exec(username)

  if (emailMatch) {
    return `${firstCharacter}***@${emailMatch[2]}`
  }

  return `${firstCharacter}***`
}

export async function saveAgentCredential(
  input: { agentId: string; scopeId: string; username: string; password: string },
  deps?: ConnectionServiceDeps,
): Promise<void> {
  const repository = resolveRepository(deps)
  const activeKey = await resolveActiveKey(deps)
  const username = input.username.trim()
  const password = input.password

  validateCredentialText('Username', username, USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH)
  validateCredentialText('Password', password, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)

  const encrypted = encryptCredential(
    { username, password },
    {
      agentId: input.agentId,
      scopeId: input.scopeId,
      provider: NATIONAL_LIFE_PROVIDER,
    },
    activeKey,
  )

  await repository.upsert({
    agentId: input.agentId,
    provider: NATIONAL_LIFE_PROVIDER,
    maskedUsername: maskUsername(username),
    keyVersion: encrypted.keyVersion,
    algorithm: encrypted.algorithm,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    authTag: encrypted.authTag,
    status: 'UNTESTED',
    lastTestedAt: null,
    lastSucceededAt: null,
    updatedAt: new Date(),
  })
}

export async function deleteAgentCredential(
  input: { agentId: string; provider: string },
  deps?: ConnectionServiceDeps,
): Promise<void> {
  const repository = resolveRepository(deps)
  await repository.delete(input.agentId, input.provider)
}

export async function getAgentConnectionSummary(
  agentId: string,
  deps?: ConnectionServiceDeps,
): Promise<ConnectionSummary | null> {
  const repository = resolveRepository(deps)
  return repository.findSummary(agentId, NATIONAL_LIFE_PROVIDER)
}
