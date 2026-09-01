'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { auth } from '@/lib/auth'
import {
  revokeNationalLifeCredential,
  saveNationalLifeCredential,
} from '@/lib/national-life/credentials/settings-service'
import type { SettingsActionState } from './state'

const saveCredentialSchema = z.strictObject({
  username: z.string().trim().min(1, 'Informe o usuário da National Life.').max(128),
  nationalLifePassword: z.string().min(1, 'Informe a senha da National Life.').max(256),
  keeprOnePassword: z.string().min(1, 'Informe sua senha atual do Keepr One.').max(128),
  consent: z.literal(true, { error: 'Confirme o consentimento para ativar o login automático.' }),
})

const revokeCredentialSchema = z.strictObject({
  keeprOnePassword: z.string().min(1, 'Informe sua senha atual do Keepr One.').max(128),
})

function formString(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function validationFailure(error: z.ZodError): SettingsActionState {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && !fieldErrors[field]) fieldErrors[field] = issue.message
  }
  return { status: 'error', message: 'Revise os campos destacados.', fieldErrors }
}

function authErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const body = 'body' in error ? error.body : null
  if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
    return body.code
  }
  return 'code' in error && typeof error.code === 'string' ? error.code : null
}

async function verifyCurrentPassword(password: string) {
  const requestHeaders = await headers()
  await auth.api.verifyPassword({
    headers: requestHeaders,
    body: { password },
  })
}

function safeCredentialFailure(error: unknown): SettingsActionState {
  if (authErrorCode(error) === 'INVALID_PASSWORD') {
    return {
      status: 'error',
      message: 'A senha atual do Keepr One não confere.',
      fieldErrors: { keeprOnePassword: 'Confira sua senha atual.' },
    }
  }
  return {
    status: 'error',
    message: 'Não foi possível atualizar a credencial protegida agora. Tente novamente.',
  }
}

export async function saveNationalLifeCredentialAction(
  _previousState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = saveCredentialSchema.safeParse({
    username: formString(formData, 'username'),
    nationalLifePassword: formString(formData, 'nationalLifePassword'),
    keeprOnePassword: formString(formData, 'keeprOnePassword'),
    consent: formData.get('consent') === 'on',
  })
  if (!parsed.success) return validationFailure(parsed.error)

  try {
    const agent = await getCurrentAgent()
    await verifyCurrentPassword(parsed.data.keeprOnePassword)
    await saveNationalLifeCredential({
      agentId: agent.id,
      userId: agent.userId,
      username: parsed.data.username,
      password: parsed.data.nationalLifePassword,
    })
    revalidatePath('/agent/settings')
    return {
      status: 'success',
      message: 'Credencial protegida. O K-Bot poderá tentar um login quando a sessão expirar.',
    }
  } catch (error) {
    return safeCredentialFailure(error)
  }
}

export async function revokeNationalLifeCredentialAction(
  _previousState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = revokeCredentialSchema.safeParse({
    keeprOnePassword: formString(formData, 'keeprOnePassword'),
  })
  if (!parsed.success) return validationFailure(parsed.error)

  try {
    const agent = await getCurrentAgent()
    await verifyCurrentPassword(parsed.data.keeprOnePassword)
    await revokeNationalLifeCredential({ agentId: agent.id, userId: agent.userId })
    revalidatePath('/agent/settings')
    return {
      status: 'success',
      message: 'Credencial removida. O K-Bot voltará a pedir login manual.',
    }
  } catch (error) {
    return safeCredentialFailure(error)
  }
}
