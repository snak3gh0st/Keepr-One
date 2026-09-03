import * as Sentry from '@sentry/nextjs'
import { Prisma } from '@prisma/client'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { auth } from '@/lib/auth'
import { sendResetPasswordEmail } from '@/lib/email/send'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const PRODUCTION_ORIGIN = 'https://app.keeprone.com'
const BOOTSTRAP_LOCK = 'keepr:production-admin-bootstrap:v1'
const BOOTSTRAP_ACTION = 'PRODUCTION_ADMIN_BOOTSTRAPPED'

// These are SHA-256 digests, never the bootstrap credential or email itself.
// The endpoint is removed immediately after the one-time production bootstrap.
const BOOTSTRAP_SECRET_SHA256 = '047415c6871607fb67115ecf7877433df3f48ab9139dc7a5735c131a07f48fb5'
const ALLOWED_EMAIL_SHA256 = '5f5d1e1c311675d2e1656b79f4be596f4d90c011478a3c7748a3be8bee6ff4a1'

type BootstrapOutcome =
  | { state: 'PASSWORD_SETUP_REQUIRED'; userId: string; email: string; newlyCreated: boolean }
  | { state: 'UNAVAILABLE' }

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function matchesDigest(value: string, expectedHex: string): boolean {
  const actual = digest(value)
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice('Bearer '.length)
  return /^[a-f0-9]{64}$/.test(token) ? token : null
}

function concealedResponse(): Response {
  return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE })
}

export async function handleFirstAdminBootstrap(
  request: Request,
  authorization: {
    bootstrapSecretSha256?: string
    allowedEmailSha256?: string
  } = {},
): Promise<Response> {
  const bootstrapSecretSha256 = authorization.bootstrapSecretSha256 ?? BOOTSTRAP_SECRET_SHA256
  const allowedEmailSha256 = authorization.allowedEmailSha256 ?? ALLOWED_EMAIL_SHA256
  const token = bearerToken(request)
  if (
    request.headers.get('origin') !== PRODUCTION_ORIGIN
    || !token
    || !matchesDigest(token, bootstrapSecretSha256)
  ) {
    return concealedResponse()
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (!Number.isFinite(contentLength) || contentLength > 1_024) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
  }

  let email: string
  try {
    const body = await request.json() as { email?: unknown }
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  } catch {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
  }

  if (!email || !matchesDigest(email, allowedEmailSha256)) return concealedResponse()

  let outcome: BootstrapOutcome
  try {
    outcome = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${BOOTSTRAP_LOCK}, 0))
      `

      const target = await transaction.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, email: true, role: true, banned: true },
      })

      if (target) {
        if (target.role !== 'ADMIN' || target.banned) return { state: 'UNAVAILABLE' as const }
        return {
          state: 'PASSWORD_SETUP_REQUIRED' as const,
          userId: target.id,
          email: target.email,
          newlyCreated: false,
        }
      }

      const user = await transaction.user.create({
        data: {
          email,
          name: 'Administrador Keepr One',
          role: 'ADMIN',
          language: 'PT',
          timeZone: 'America/New_York',
          emailVerified: false,
        },
        select: { id: true },
      })

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: BOOTSTRAP_ACTION,
          entity: 'User',
          entityId: user.id,
          after: {
            role: 'ADMIN',
            source: 'ONE_TIME_PRODUCTION_BOOTSTRAP',
            emailSha256: allowedEmailSha256,
          },
        },
      })

      return {
        state: 'PASSWORD_SETUP_REQUIRED' as const,
        userId: user.id,
        email,
        newlyCreated: true,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    Sentry.captureException(error)
    return Response.json({ error: 'BOOTSTRAP_FAILED' }, { status: 500, headers: NO_STORE })
  }

  if (outcome.state === 'UNAVAILABLE') {
    return Response.json({ error: 'BOOTSTRAP_UNAVAILABLE' }, { status: 409, headers: NO_STORE })
  }

  let verificationIdentifier: string | null = null
  try {
    const token = randomBytes(32).toString('base64url')
    verificationIdentifier = `reset-password:${token}`
    const context = await auth.$context
    await context.internalAdapter.createVerificationValue({
      identifier: verificationIdentifier,
      value: outcome.userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    })

    const resetUrl = new URL(`/api/auth/reset-password/${token}`, PRODUCTION_ORIGIN)
    resetUrl.searchParams.set('callbackURL', '/reset-password?lang=PT&portal=admin')
    await sendResetPasswordEmail({
      to: outcome.email,
      resetUrl: resetUrl.toString(),
      language: 'PT',
    })

    // Resend has accepted a message containing the only credential-creation
    // path. Until that one-time link is consumed, the account stays
    // passwordless and cannot create a session.
    const verified = await prisma.user.updateMany({
      where: {
        id: outcome.userId,
        email: outcome.email,
        role: 'ADMIN',
        banned: false,
      },
      data: { emailVerified: true },
    })
    if (verified.count !== 1) throw new Error('PRODUCTION_ADMIN_VERIFICATION_STATE_CHANGED')

    try {
      await prisma.auditLog.create({
        data: {
          userId: outcome.userId,
          action: 'ADMIN_PASSWORD_RESET_REQUESTED',
          entity: 'User',
          entityId: outcome.userId,
          after: { delivery: 'EMAIL', source: 'PRODUCTION_ADMIN_BOOTSTRAP' },
        },
      })
    } catch (auditError) {
      Sentry.captureException(auditError)
    }

    return Response.json(
      {
        ok: true,
        state: outcome.newlyCreated ? 'CREATED' : 'PASSWORD_SETUP_REISSUED',
        emailSent: true,
      },
      { status: outcome.newlyCreated ? 201 : 200, headers: NO_STORE },
    )
  } catch {
    // Redis errors may carry command arguments, including the live reset
    // token. Never forward the adapter/provider error object to telemetry.
    Sentry.captureException(new Error('Production admin password setup delivery failed'))
    if (verificationIdentifier) {
      try {
        const context = await auth.$context
        await context.internalAdapter.deleteVerificationByIdentifier(verificationIdentifier)
      } catch {
        Sentry.captureException(new Error('Production admin reset verification cleanup failed'))
      }
    }
    return Response.json(
      {
        ok: false,
        partial: true,
        state: outcome.newlyCreated ? 'CREATED' : 'PASSWORD_SETUP_RETRY_FAILED',
        emailSent: false,
      },
      { status: 502, headers: NO_STORE },
    )
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleFirstAdminBootstrap(request)
}
