"use server";

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import {
  deleteAgentCredential,
  getAgentConnectionSummary,
  saveAgentCredential,
} from '@/lib/national-life/connection-service'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'

const NOT_CONFIGURED_MESSAGE = 'Esta integração ainda não foi configurada. Fale com o time técnico.'

const SAVE_CONNECTION_SCHEMA = z.object({
  username: z.string().trim().min(1, 'Informe o usuário.').max(200, 'O usuário deve ter no máximo 200 caracteres.'),
  password: z.string().min(1, 'Informe a senha.').max(500, 'A senha deve ter no máximo 500 caracteres.'),
})

const CONNECTION_TEST_LIMIT = 5
const CONNECTION_TEST_WINDOW_MS = 15 * 60_000
const CONNECTION_PATH = '/agent/integrations/national-life'

export type ConnectionActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

function revalidateConnectionPath() {
  revalidatePath(CONNECTION_PATH)
}

export async function saveNationalLifeConnection(formData: FormData): Promise<ConnectionActionResult> {
  if (!isNationalLifeConfigured()) {
    return { ok: false, message: NOT_CONFIGURED_MESSAGE }
  }

  try {
    const agent = await getCurrentAgent()
    const parsed = SAVE_CONNECTION_SCHEMA.safeParse({
      username: formData.get('username'),
      password: formData.get('password'),
    })

    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
    }

    const env = getNationalLifeEnv()

    await saveAgentCredential({
      agentId: agent.id,
      scopeId: env.credentialScopeId,
      username: parsed.data.username,
      password: parsed.data.password,
    })

    revalidateConnectionPath()
    return { ok: true, message: 'Conexão National Life salva com segurança.' }
  } catch {
    return { ok: false, message: 'Não foi possível salvar a conexão agora.' }
  }
}

export async function deleteNationalLifeConnection(): Promise<ConnectionActionResult> {
  try {
    const agent = await getCurrentAgent()

    await deleteAgentCredential({
      agentId: agent.id,
      provider: NATIONAL_LIFE_PROVIDER,
    })

    revalidateConnectionPath()
    return { ok: true, message: 'Conexão National Life removida.' }
  } catch {
    return { ok: false, message: 'Não foi possível remover a conexão agora.' }
  }
}

export async function testNationalLifeConnection(): Promise<ConnectionActionResult> {
  if (!isNationalLifeConfigured()) {
    return { ok: false, message: NOT_CONFIGURED_MESSAGE }
  }

  try {
    const agent = await getCurrentAgent()
    const connection = await getAgentConnectionSummary(agent.id)

    if (!connection) {
      return { ok: false, message: 'Salve as credenciais antes de testar a conexão.' }
    }

    const fifteenMinutesAgo = new Date(Date.now() - CONNECTION_TEST_WINDOW_MS)
    const recentAttempts = await prisma.browserAutomationJob.count({
      where: {
        agentId: agent.id,
        provider: NATIONAL_LIFE_PROVIDER,
        operation: 'TEST_CONNECTION',
        createdAt: { gte: fifteenMinutesAgo },
      },
    })

    if (recentAttempts >= CONNECTION_TEST_LIMIT) {
      return { ok: false, message: 'Você atingiu o limite de testes recentes. Aguarde alguns minutos e tente novamente.' }
    }

    const env = getNationalLifeEnv()

    await prisma.browserAutomationJob.create({
      data: {
        agentId: agent.id,
        provider: NATIONAL_LIFE_PROVIDER,
        operation: 'TEST_CONNECTION',
        idempotencyKey: `national-life-test-${randomUUID()}`,
        input: {
          scopeId: env.credentialScopeId,
        },
      },
    })

    revalidateConnectionPath()
    return { ok: true, message: 'Teste enfileirado. O worker validará a conexão sem expor suas credenciais.' }
  } catch {
    return { ok: false, message: 'Não foi possível iniciar o teste de conexão agora.' }
  }
}
