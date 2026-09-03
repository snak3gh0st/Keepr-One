import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

export const runtime = 'nodejs'

function appendSetCookies(target: Headers, source: Headers) {
  const cookieHeaders = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
  if (cookieHeaders?.length) {
    for (const cookie of cookieHeaders) target.append('set-cookie', cookie)
    return
  }
  const cookie = source.get('set-cookie')
  if (cookie) target.append('set-cookie', cookie)
}

function expirePreviewCookies(headers: Headers, includeSession: boolean) {
  const names = [
    'better-auth.admin_session',
    '__Secure-better-auth.admin_session',
    ...(includeSession
      ? [
          'better-auth.session_token',
          '__Secure-better-auth.session_token',
          'better-auth.dont_remember',
          '__Secure-better-auth.dont_remember',
          'better-auth.session_data',
          '__Secure-better-auth.session_data',
        ]
      : []),
  ]
  for (const name of names) {
    const secure = name.startsWith('__Secure-') ? '; Secure' : ''
    headers.append(
      'set-cookie',
      `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    )
  }
}

async function emergencyPreviewExit(request: Request) {
  let signOutHeaders: Headers | null = null
  try {
    const signedOut = await auth.api.signOut({
      headers: request.headers,
      returnHeaders: true,
    })
    signOutHeaders = signedOut.headers
  } catch (signOutError) {
    console.error('Emergency user preview sign-out failed', signOutError)
  }

  const response = NextResponse.json({
    ok: true,
    restored: false,
    redirectTo: '/login?preview=ended',
  })
  if (signOutHeaders) appendSetCookies(response.headers, signOutHeaders)
  expirePreviewCookies(response.headers, true)
  return response
}

export async function POST(request: Request) {
  assertSameOriginAction({
    origin: request.headers.get('origin'),
    host: request.headers.get('host'),
    forwardedHost: request.headers.get('x-forwarded-host'),
    forwardedProto: request.headers.get('x-forwarded-proto'),
  })

  const current = await auth.api.getSession({ headers: request.headers })
  const administratorId = (current?.session as { impersonatedBy?: unknown } | undefined)?.impersonatedBy
  if (!current || typeof administratorId !== 'string' || current.user.role === 'ADMIN') {
    return NextResponse.json({ message: 'No active user preview.' }, { status: 400 })
  }

  const administrator = await prisma.user.findFirst({
    where: { id: administratorId, role: 'ADMIN', banned: false },
    select: { id: true },
  })
  if (!administrator) {
    return emergencyPreviewExit(request)
  }

  let auditId: string | null = null
  try {
    const audit = await prisma.auditLog.create({
      data: {
        userId: administrator.id,
        action: 'ADMIN_USER_PREVIEW_ENDED',
        entity: 'User',
        entityId: current.user.id,
        before: { targetRole: current.user.role, mode: 'READ_ONLY' },
        after: { restoredAdminSession: true },
      },
      select: { id: true },
    })
    auditId = audit.id
  } catch (auditError) {
    // Session restoration is the safety-critical operation. An audit storage
    // incident is reported, but must never trap a manager in the target account.
    console.error('Could not record user preview end', auditError)
  }

  try {
    const stopped = await auth.api.stopImpersonating({
      headers: request.headers,
      returnHeaders: true,
    })
    const response = NextResponse.json({
      ok: true,
      redirectTo: `/admin/users/${current.user.id}`,
    })
    appendSetCookies(response.headers, stopped.headers)
    // Better Auth normally expires this itself. The explicit expiration also
    // removes the alternate secure/non-secure cookie name after environment
    // changes between local, preview and production hosts.
    expirePreviewCookies(response.headers, false)
    return response
  } catch (error) {
    console.error('Stopping admin user preview failed', error)
    try {
      if (!auditId) throw new Error('AUDIT_RECORD_UNAVAILABLE')
      await prisma.auditLog.update({
        where: { id: auditId },
        data: {
          action: 'ADMIN_USER_PREVIEW_STOP_FAILED',
          after: { restoredAdminSession: false, fallback: 'SIGNED_OUT' },
        },
      })
    } catch (auditError) {
      console.error('Could not record failed user preview restoration', auditError)
    }

    // Never trap a Keepr One manager inside the target account. If the
    // preserved administrative session can no longer be restored, end the
    // target session, clear both cookie variants, and require a fresh login.
    return emergencyPreviewExit(request)
  }
}
