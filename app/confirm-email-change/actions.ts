'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import {
  ADMIN_EMAIL_CHANGE_TOKEN_PATTERN,
  ADMIN_EMAIL_CHANGE_TTL_MS,
  adminEmailChangeConfirmationUrl,
  createAdminEmailChangeToken,
  hashAdminEmailChangeToken,
  normalizeLoginEmail,
} from '@/lib/admin/email-change'
import { revokeAllAuthSessions } from '@/lib/auth-session-revocation'
import { sendAdminEmailChangeVerificationEmail } from '@/lib/email/send'
import { localize } from '@/lib/i18n/catalog'
import type { UserLanguage } from '@/lib/i18n/config'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

export type ConfirmEmailChangeActionState = {
  status: 'idle' | 'success' | 'error'
  message: string
  completed?: boolean
  canRetry?: boolean
  loginEmail?: string
}

export const INITIAL_CONFIRM_EMAIL_CHANGE_STATE: ConfirmEmailChangeActionState = {
  status: 'idle',
  message: '',
}

const confirmationSchema = z.object({
  token: z.string().regex(ADMIN_EMAIL_CHANGE_TOKEN_PATTERN),
  language: z.enum(['PT', 'EN']),
})

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function copy(language: UserLanguage, portuguese: string, english: string): string {
  return localize(language, portuguese, english)
}

function refreshAfterConfirmation(userId: string) {
  revalidatePath('/admin')
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  revalidatePath('/admin/audit')
}

export async function confirmAdminEmailChangeAction(
  _previousState: ConfirmEmailChangeActionState,
  formData: FormData,
): Promise<ConfirmEmailChangeActionState> {
  const language = formString(formData, 'language') === 'EN' ? 'EN' : 'PT'
  const parsed = confirmationSchema.safeParse({
    token: formString(formData, 'token'),
    language,
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: copy(language, 'Este link é inválido ou já foi utilizado.', 'This link is invalid or has already been used.'),
    }
  }

  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })

  const tokenHash = hashAdminEmailChangeToken(parsed.data.token)
  const nextToken = createAdminEmailChangeToken()
  const now = new Date()
  const nextTokenExpiresAt = new Date(now.getTime() + ADMIN_EMAIL_CHANGE_TTL_MS)

  try {
    const prepared = await prisma.$transaction(async (transaction) => {
      const request = await transaction.adminEmailChangeRequest.findFirst({
        where: {
          OR: [
            { currentTokenHash: tokenHash },
            { newTokenHash: tokenHash },
          ],
        },
        select: {
          id: true,
          userId: true,
          requestedById: true,
          originalEmail: true,
          originalEmailVerified: true,
          newEmail: true,
          currentTokenHash: true,
          newTokenHash: true,
          expectedUserUpdatedAt: true,
          expiresAt: true,
          currentApprovedAt: true,
          newTokenExpiresAt: true,
          version: true,
          user: {
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
          },
        },
      })
      if (!request) return { kind: 'INVALID' as const }
      const requester = await transaction.user.findUnique({
        where: { id: request.requestedById },
        select: { role: true, banned: true },
      })
      if (!requester || requester.role !== 'ADMIN' || requester.banned) {
        return { kind: 'REQUESTER_INACTIVE' as const }
      }
      if (request.user.role === 'ADMIN') return { kind: 'PROTECTED' as const }
      if (request.user.banned) return { kind: 'SUSPENDED' as const }
      if (
        normalizeLoginEmail(request.user.email) !== normalizeLoginEmail(request.originalEmail)
        || request.user.updatedAt.getTime() !== request.expectedUserUpdatedAt.getTime()
      ) {
        return { kind: 'STALE' as const }
      }

      const emailOwner = await transaction.user.findFirst({
        where: {
          email: { equals: request.newEmail, mode: 'insensitive' },
          id: { not: request.userId },
        },
        select: { id: true },
      })
      if (emailOwner) return { kind: 'EMAIL_IN_USE' as const }

      if (request.currentTokenHash === tokenHash) {
        if (request.expiresAt <= now) {
          await transaction.adminEmailChangeRequest.deleteMany({
            where: { id: request.id, version: request.version },
          })
          return { kind: 'EXPIRED' as const }
        }
        if (request.currentApprovedAt) {
          return { kind: 'CURRENT_ALREADY_APPROVED' as const }
        }

        const approval = await transaction.adminEmailChangeRequest.updateMany({
          where: { id: request.id, version: request.version, currentApprovedAt: null },
          data: {
            currentApprovedAt: now,
            newTokenHash: nextToken.tokenHash,
            newTokenExpiresAt: nextTokenExpiresAt,
            expiresAt: nextTokenExpiresAt,
            version: { increment: 1 },
          },
        })
        if (approval.count !== 1) throw new Error('CONCURRENT_CONFIRMATION')
        await transaction.auditLog.create({
          data: {
            userId: request.requestedById,
            action: 'ADMIN_USER_EMAIL_CHANGE_CURRENT_APPROVED',
            entity: 'User',
            entityId: request.userId,
            after: {
              approvedAddress: 'CURRENT_EMAIL',
              requestedEmail: request.newEmail,
              nextApproval: 'NEW_EMAIL',
            },
          },
        })
        return {
          kind: 'SEND_NEW_CONFIRMATION' as const,
          request: { ...request, claimedVersion: request.version + 1 },
        }
      }

      if (
        request.newTokenHash !== tokenHash
        || !request.currentApprovedAt
        || !request.newTokenExpiresAt
      ) {
        return { kind: 'INVALID' as const }
      }
      if (request.newTokenExpiresAt <= now) return { kind: 'EXPIRED' as const }
      return { kind: 'READY_TO_COMPLETE' as const, request }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (prepared.kind === 'SEND_NEW_CONFIRMATION') {
      const confirmationUrl = adminEmailChangeConfirmationUrl(
        nextToken.rawToken,
        prepared.request.user.language,
      )
      try {
        await sendAdminEmailChangeVerificationEmail({
          to: prepared.request.newEmail,
          accountName: prepared.request.user.name,
          confirmationUrl,
          expiresAt: nextTokenExpiresAt,
          language: prepared.request.user.language,
          idempotencyKey: `admin-email-change-new-${prepared.request.id}-v${prepared.request.claimedVersion}`,
        })
      } catch (deliveryError) {
        await prisma.$transaction(async (transaction) => {
          await transaction.adminEmailChangeRequest.updateMany({
            where: {
              id: prepared.request.id,
              version: prepared.request.claimedVersion,
              newTokenHash: nextToken.tokenHash,
            },
            data: {
              currentApprovedAt: null,
              newTokenHash: null,
              newTokenExpiresAt: null,
              version: { increment: 1 },
            },
          })
          await transaction.auditLog.create({
            data: {
              userId: prepared.request.requestedById,
              action: 'ADMIN_USER_EMAIL_CHANGE_DELIVERY_FAILED',
              entity: 'User',
              entityId: prepared.request.userId,
              after: {
                requestedEmail: prepared.request.newEmail,
                delivery: 'FAILED',
                stage: 'NEW_EMAIL',
              },
            },
          })
        }).catch((cleanupError) => {
          console.error('New email confirmation cleanup failed', cleanupError)
        })
        console.error('New email confirmation delivery failed', deliveryError)
        return {
          status: 'error',
          canRetry: true,
          message: copy(
            language,
            'Não foi possível enviar a segunda confirmação. Tente autorizar novamente por este link.',
            'We could not send the second confirmation. Try authorizing again from this link.',
          ),
        }
      }

      refreshAfterConfirmation(prepared.request.userId)
      return {
        status: 'success',
        completed: false,
        message: copy(
          language,
          `Primeira etapa concluída. Enviamos a confirmação final para ${prepared.request.newEmail}.`,
          `First step complete. We sent the final confirmation to ${prepared.request.newEmail}.`,
        ),
      }
    }

    if (prepared.kind !== 'READY_TO_COMPLETE') {
      const messages = {
        INVALID: copy(language, 'Este link é inválido ou já foi utilizado.', 'This link is invalid or has already been used.'),
        EXPIRED: copy(language, 'Este link expirou. Solicite um novo ao administrador.', 'This link expired. Ask the administrator for a new one.'),
        PROTECTED: copy(language, 'Esta conta administrativa é protegida.', 'This administrative account is protected.'),
        SUSPENDED: copy(language, 'Esta conta está suspensa. Fale com o administrador.', 'This account is suspended. Contact the administrator.'),
        STALE: copy(language, 'A conta mudou depois deste pedido. Solicite um novo link.', 'The account changed after this request. Ask for a new link.'),
        EMAIL_IN_USE: copy(language, 'Este endereço já está associado a outra conta.', 'This address is already associated with another account.'),
        REQUESTER_INACTIVE: copy(
          language,
          'Esta solicitação administrativa não está mais ativa. Peça um novo link.',
          'This administrative request is no longer active. Ask for a new link.',
        ),
        CURRENT_ALREADY_APPROVED: copy(
          language,
          'A primeira etapa já foi concluída. Use o link enviado ao novo e-mail.',
          'The first step is already complete. Use the link sent to the new email.',
        ),
      }
      return { status: 'error', message: messages[prepared.kind] }
    }

    // Fail closed: the identity is still unchanged here. The same one-time
    // link remains valid if either Postgres or Redis revocation fails.
    try {
      await revokeAllAuthSessions(prepared.request.userId)
    } catch (revocationError) {
      console.error('Email change session revocation failed', revocationError)
      return {
        status: 'error',
        canRetry: true,
        message: copy(
          language,
          'Não foi possível encerrar todas as sessões. O e-mail não foi alterado; tente novamente.',
          'We could not revoke every session. The email was not changed; try again.',
        ),
      }
    }

    const finalUpdatedAt = new Date(Math.max(
      Date.now(),
      prepared.request.expectedUserUpdatedAt.getTime() + 1,
    ))
    await prisma.$transaction(async (transaction) => {
      const currentRequest = await transaction.adminEmailChangeRequest.findUnique({
        where: { id: prepared.request.id },
        select: {
          newTokenHash: true,
          currentApprovedAt: true,
          newTokenExpiresAt: true,
          version: true,
        },
      })
      if (
        !currentRequest
        || currentRequest.newTokenHash !== tokenHash
        || !currentRequest.currentApprovedAt
        || !currentRequest.newTokenExpiresAt
        || currentRequest.newTokenExpiresAt <= new Date()
        || currentRequest.version !== prepared.request.version
      ) {
        throw new Error('CONCURRENT_CONFIRMATION')
      }

      const emailOwner = await transaction.user.findFirst({
        where: {
          email: { equals: prepared.request.newEmail, mode: 'insensitive' },
          id: { not: prepared.request.userId },
        },
        select: { id: true },
      })
      if (emailOwner) throw new Error('EMAIL_IN_USE')

      const requester = await transaction.user.findUnique({
        where: { id: prepared.request.requestedById },
        select: { role: true, banned: true },
      })
      if (!requester || requester.role !== 'ADMIN' || requester.banned) {
        throw new Error('REQUESTER_INACTIVE')
      }

      const changed = await transaction.user.updateMany({
        where: {
          id: prepared.request.userId,
          email: prepared.request.originalEmail,
          updatedAt: prepared.request.expectedUserUpdatedAt,
          role: { not: 'ADMIN' },
          banned: false,
        },
        data: {
          email: prepared.request.newEmail,
          emailVerified: true,
          updatedAt: finalUpdatedAt,
        },
      })
      if (changed.count !== 1) throw new Error('STALE_USER')

      await transaction.auditLog.create({
        data: {
          userId: prepared.request.requestedById,
          action: 'ADMIN_USER_EMAIL_CHANGE_COMPLETED',
          entity: 'User',
          entityId: prepared.request.userId,
          before: {
            email: prepared.request.originalEmail,
            emailVerified: prepared.request.originalEmailVerified,
          },
          after: {
            email: prepared.request.newEmail,
            emailVerified: true,
            approvals: ['CURRENT_EMAIL', 'NEW_EMAIL'],
            sessionsRevoked: true,
          },
        },
      })
      const consumed = await transaction.adminEmailChangeRequest.deleteMany({
        where: { id: prepared.request.id, version: prepared.request.version },
      })
      if (consumed.count !== 1) throw new Error('CONCURRENT_CONFIRMATION')
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    refreshAfterConfirmation(prepared.request.userId)
    return {
      status: 'success',
      completed: true,
      message: copy(
        language,
        'Novo e-mail confirmado. Todas as sessões anteriores foram encerradas.',
        'New email confirmed. All previous sessions were revoked.',
      ),
      loginEmail: prepared.request.newEmail,
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        status: 'error',
        message: copy(language, 'Este endereço já está associado a outra conta.', 'This address is already associated with another account.'),
      }
    }
    if (error instanceof Error && error.message === 'EMAIL_IN_USE') {
      return {
        status: 'error',
        message: copy(language, 'Este endereço já está associado a outra conta.', 'This address is already associated with another account.'),
      }
    }
    if (error instanceof Error && error.message === 'STALE_USER') {
      return {
        status: 'error',
        message: copy(language, 'A conta mudou depois deste pedido. Solicite um novo link.', 'The account changed after this request. Ask for a new link.'),
      }
    }
    if (error instanceof Error && error.message === 'REQUESTER_INACTIVE') {
      return {
        status: 'error',
        message: copy(
          language,
          'Esta solicitação administrativa não está mais ativa. Peça um novo link.',
          'This administrative request is no longer active. Ask for a new link.',
        ),
      }
    }
    if (error instanceof Error && error.message === 'CONCURRENT_CONFIRMATION') {
      return {
        status: 'error',
        canRetry: true,
        message: copy(
          language,
          'A confirmação já está sendo processada. Aguarde um instante e tente novamente.',
          'Confirmation is already being processed. Wait a moment and try again.',
        ),
      }
    }
    console.error('Admin email change confirmation failed', error)
    return {
      status: 'error',
      canRetry: true,
      message: copy(
        language,
        'Não foi possível confirmar o novo e-mail agora. Tente novamente.',
        'We could not confirm the new email right now. Try again.',
      ),
    }
  }
}
