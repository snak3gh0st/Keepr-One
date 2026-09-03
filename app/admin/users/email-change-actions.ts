'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import {
  ADMIN_EMAIL_CHANGE_TTL_MS,
  adminEmailChangeConfirmationUrl,
  createAdminEmailChangeToken,
  normalizeLoginEmail,
} from '@/lib/admin/email-change'
import { sendAdminEmailChangeAuthorizationEmail } from '@/lib/email/send'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

export type EmailChangeRequestActionState = {
  status: 'idle' | 'success' | 'error'
  message: string
  fieldErrors?: { newEmail?: string }
}

const requestSchema = z.object({
  userId: z.string().cuid(),
  expectedUpdatedAt: z.string().datetime(),
  newEmail: z.email().max(254).transform(normalizeLoginEmail),
})

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function refreshUserSurfaces(userId: string) {
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  revalidatePath('/admin/audit')
}

export async function requestManagedUserEmailChangeAction(
  _previousState: EmailChangeRequestActionState,
  formData: FormData,
): Promise<EmailChangeRequestActionState> {
  const { copy } = await getServerI18n()
  const parsed = requestSchema.safeParse({
    userId: formString(formData, 'userId'),
    expectedUpdatedAt: formString(formData, 'expectedUpdatedAt'),
    newEmail: formString(formData, 'newEmail'),
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: copy('Revise o novo e-mail.', 'Review the new email.'),
      fieldErrors: {
        newEmail: copy('Informe um endereço de e-mail válido.', 'Enter a valid email address.'),
      },
    }
  }

  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
  const session = await requireRole('ADMIN')
  if (session.user.id === parsed.data.userId) {
    return {
      status: 'error',
      message: copy(
        'Para proteger o acesso ao painel, você não pode trocar o próprio e-mail aqui.',
        'To protect admin access, you cannot change your own email here.',
      ),
    }
  }

  const now = new Date()
  const expectedUpdatedAt = new Date(parsed.data.expectedUpdatedAt)
  const lockedAt = new Date(Math.max(now.getTime(), expectedUpdatedAt.getTime() + 1))
  const expiresAt = new Date(now.getTime() + ADMIN_EMAIL_CHANGE_TTL_MS)
  const { rawToken, tokenHash: currentTokenHash } = createAdminEmailChangeToken()

  try {
    const pending = await prisma.$transaction(async (transaction) => {
      await transaction.adminEmailChangeRequest.deleteMany({
        where: {
          OR: [
            { currentApprovedAt: null, expiresAt: { lte: now } },
            { currentApprovedAt: { not: null }, newTokenExpiresAt: { lte: now } },
          ],
        },
      })
      const target = await transaction.user.findUnique({
        where: { id: parsed.data.userId },
        select: {
          id: true,
          email: true,
          emailVerified: true,
          name: true,
          language: true,
          role: true,
          banned: true,
          updatedAt: true,
        },
      })
      if (!target) throw new Error('TARGET_NOT_FOUND')
      if (target.role === 'ADMIN') throw new Error('ADMIN_PROTECTED')
      if (target.banned) throw new Error('TARGET_SUSPENDED')
      if (target.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new Error('STALE_USER')
      }
      if (normalizeLoginEmail(target.email) === parsed.data.newEmail) {
        throw new Error('SAME_EMAIL')
      }

      const emailOwner = await transaction.user.findFirst({
        where: {
          email: { equals: parsed.data.newEmail, mode: 'insensitive' },
          id: { not: target.id },
        },
        select: { id: true },
      })
      if (emailOwner) throw new Error('EMAIL_IN_USE')

      const reserved = await transaction.adminEmailChangeRequest.findFirst({
        where: { newEmail: parsed.data.newEmail, userId: { not: target.id } },
        select: { id: true },
      })
      if (reserved) throw new Error('EMAIL_IN_USE')

      const lock = await transaction.user.updateMany({
        where: { id: target.id, updatedAt: expectedUpdatedAt },
        // Lock the exact profile version without changing the login identity.
        data: { updatedAt: lockedAt },
      })
      if (lock.count !== 1) throw new Error('STALE_USER')

      await transaction.adminEmailChangeRequest.deleteMany({ where: { userId: target.id } })
      const created = await transaction.adminEmailChangeRequest.create({
        data: {
          userId: target.id,
          requestedById: session.user.id,
          originalEmail: target.email,
          originalEmailVerified: target.emailVerified,
          newEmail: parsed.data.newEmail,
          currentTokenHash,
          expectedUserUpdatedAt: lockedAt,
          expiresAt,
        },
        select: { id: true },
      })
      await transaction.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'ADMIN_USER_EMAIL_CHANGE_REQUESTED',
          entity: 'User',
          entityId: target.id,
          before: { email: target.email, emailVerified: target.emailVerified },
          after: {
            requestedEmail: parsed.data.newEmail,
            delivery: 'EMAIL',
            expiresAt: expiresAt.toISOString(),
            approvalSteps: ['CURRENT_EMAIL', 'NEW_EMAIL'],
          },
        },
      })
      return {
        requestId: created.id,
        userId: target.id,
        currentEmail: target.email,
        accountName: target.name,
        language: target.language,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    const confirmationUrl = adminEmailChangeConfirmationUrl(rawToken, pending.language)
    try {
      await sendAdminEmailChangeAuthorizationEmail({
        to: pending.currentEmail,
        accountName: pending.accountName,
        newEmail: parsed.data.newEmail,
        authorizationUrl: confirmationUrl,
        expiresAt,
        language: pending.language,
        idempotencyKey: `admin-email-change-current-${pending.requestId}`,
      })
    } catch (deliveryError) {
      await prisma.$transaction([
        prisma.adminEmailChangeRequest.deleteMany({ where: { id: pending.requestId } }),
        prisma.auditLog.create({
          data: {
            userId: session.user.id,
            action: 'ADMIN_USER_EMAIL_CHANGE_DELIVERY_FAILED',
            entity: 'User',
            entityId: pending.userId,
            after: { requestedEmail: parsed.data.newEmail, delivery: 'FAILED' },
          },
        }),
      ]).catch((cleanupError) => {
        console.error('Admin email change cleanup failed', cleanupError)
      })
      console.error('Admin email change delivery failed', deliveryError)
      refreshUserSurfaces(pending.userId)
      return {
        status: 'error',
        message: copy(
          'Não foi possível entregar a confirmação. O e-mail atual não foi alterado.',
          'We could not deliver the confirmation. The current email was not changed.',
        ),
      }
    }

    refreshUserSurfaces(pending.userId)
    return {
      status: 'success',
      message: copy(
        `Autorização enviada para ${pending.currentEmail}. O e-mail atual permanece ativo até os dois endereços confirmarem.`,
        `Authorization sent to ${pending.currentEmail}. The current email stays active until both addresses confirm.`,
      ),
    }
  } catch (error) {
    if (error instanceof Error) {
      const messages: Record<string, string> = {
        TARGET_NOT_FOUND: copy('Usuário não encontrado.', 'User not found.'),
        ADMIN_PROTECTED: copy(
          'O e-mail de uma conta administrativa não pode ser alterado por este painel.',
          'An administrative account email cannot be changed from this panel.',
        ),
        TARGET_SUSPENDED: copy(
          'Restaure o acesso antes de trocar o e-mail.',
          'Restore access before changing the email.',
        ),
        STALE_USER: copy(
          'Este usuário mudou em outra sessão. Atualize a página antes de tentar novamente.',
          'This user changed in another session. Refresh the page before trying again.',
        ),
        SAME_EMAIL: copy(
          'O novo endereço precisa ser diferente do e-mail atual.',
          'The new address must be different from the current email.',
        ),
        EMAIL_IN_USE: copy(
          'Este endereço já pertence a outra conta ou solicitação pendente.',
          'This address already belongs to another account or pending request.',
        ),
      }
      if (messages[error.message]) {
        return {
          status: 'error',
          message: messages[error.message],
          fieldErrors: ['SAME_EMAIL', 'EMAIL_IN_USE'].includes(error.message)
            ? { newEmail: messages[error.message] }
            : undefined,
        }
      }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        status: 'error',
        message: copy(
          'Este endereço já pertence a outra conta ou solicitação pendente.',
          'This address already belongs to another account or pending request.',
        ),
        fieldErrors: {
          newEmail: copy('Use outro endereço de e-mail.', 'Use a different email address.'),
        },
      }
    }
    console.error('Admin email change request failed', error)
    return {
      status: 'error',
      message: copy(
        'Não foi possível iniciar a troca de e-mail agora.',
        'We could not start the email change right now.',
      ),
    }
  }
}
