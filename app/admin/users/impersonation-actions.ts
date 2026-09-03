'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

export type ImpersonationActionState = {
  status: 'idle' | 'error'
  message: string
}

const startSchema = z.object({
  userId: z.string().cuid(),
  reason: z.string().trim().min(5).max(240),
  confirmed: z.literal('yes'),
})

function formString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function assertRequestOrigin(requestHeaders: Headers) {
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
}

export async function startManagedUserImpersonationAction(
  _previousState: ImpersonationActionState,
  formData: FormData,
): Promise<ImpersonationActionState> {
  const requestHeaders = await headers()
  assertRequestOrigin(requestHeaders)
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()
  const parsed = startSchema.safeParse({
    userId: formString(formData, 'userId'),
    reason: formString(formData, 'reason'),
    confirmed: formString(formData, 'confirmed'),
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: copy(
        'Informe o motivo e confirme que esta visualização será somente leitura.',
        'Enter a reason and confirm that this preview will be read-only.',
      ),
    }
  }
  if (parsed.data.userId === session.user.id) {
    return {
      status: 'error',
      message: copy('Sua própria conta já está aberta.', 'Your own account is already open.'),
    }
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: {
      id: true,
      name: true,
      role: true,
      banned: true,
      agent: { select: { id: true, status: true } },
      client: { select: { id: true } },
    },
  })

  if (!target) {
    return { status: 'error', message: copy('Usuário não encontrado.', 'User not found.') }
  }
  if (target.role === 'ADMIN') {
    return {
      status: 'error',
      message: copy(
        'Contas da equipe Keepr One não podem ser visualizadas por impersonação.',
        'Keepr One staff accounts cannot be opened through impersonation.',
      ),
    }
  }
  if (target.banned) {
    return {
      status: 'error',
      message: copy(
        'Restaure o acesso da conta antes de abrir o painel.',
        'Restore account access before opening the dashboard.',
      ),
    }
  }
  if (target.role === 'AGENT' && (!target.agent || target.agent.status !== 'ACTIVE')) {
    return {
      status: 'error',
      message: copy(
        'Este agente não possui um perfil operacional ativo.',
        'This agent does not have an active operational profile.',
      ),
    }
  }
  if (target.role === 'CLIENT' && !target.client) {
    return {
      status: 'error',
      message: copy(
        'Este cliente não possui um portal vinculado.',
        'This client does not have a linked portal.',
      ),
    }
  }

  const audit = await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'ADMIN_USER_PREVIEW_STARTED',
      entity: 'User',
      entityId: target.id,
      after: {
        reason: parsed.data.reason,
        targetRole: target.role,
        mode: 'READ_ONLY',
        durationMinutes: 15,
      },
    },
    select: { id: true },
  })

  try {
    await auth.api.impersonateUser({
      headers: requestHeaders,
      body: { userId: target.id },
    })
  } catch (error) {
    console.error('Admin user preview failed', error)
    try {
      await prisma.auditLog.update({
        where: { id: audit.id },
        data: {
          action: 'ADMIN_USER_PREVIEW_FAILED',
          after: {
            reason: parsed.data.reason,
            targetRole: target.role,
            mode: 'READ_ONLY',
            durationMinutes: 15,
            outcome: 'FAILED',
          },
        },
      })
    } catch (auditError) {
      console.error('Could not record failed admin user preview', auditError)
    }
    return {
      status: 'error',
      message: copy(
        'Não foi possível abrir o painel deste usuário agora.',
        'We could not open this user dashboard right now.',
      ),
    }
  }

  redirect(target.role === 'CLIENT' ? '/client' : '/agent')
}
