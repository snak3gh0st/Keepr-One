import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isReadOnlySupportPreview } from '@/lib/support-preview'
import {
  getPlatformModuleForPath,
  normalizePlatformModules,
  type PlatformModuleName,
} from '@/lib/platform-modules'

// The proxy has two deliberately separate responsibilities:
// 1. a cheap cookie-presence redirect for private product pages; and
// 2. an authoritative read-only boundary for Keepr One support previews.
//
// Page and resource authorization still belongs to requireRole(). Only unsafe
// preview requests resolve the database-backed Better Auth session here. The
// global matcher is intentional: a Next Server Action can be replayed against
// a different App Router pathname, so a prefix-only matcher is not a complete
// mutation boundary.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const STOP_PREVIEW_PATH = '/api/admin/user-preview/stop'

function moduleDeniedResponse(request: NextRequest, module: PlatformModuleName) {
  const pathname = request.nextUrl.pathname
  if (pathname.startsWith('/api/') || !SAFE_METHODS.has(request.method)) {
    return NextResponse.json(
      {
        error: 'PLATFORM_MODULE_DISABLED',
        message: 'This module is not enabled for the current account.',
        module,
      },
      {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }

  // TODAY is always re-added by normalizePlatformModules, making this a safe
  // destination even if an older administrative write omitted the baseline.
  const destination = request.nextUrl.clone()
  destination.pathname = '/agent'
  destination.search = ''
  destination.searchParams.set('module', 'blocked')
  return NextResponse.redirect(destination)
}

function isSafeDuringPreview(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (pathname === STOP_PREVIEW_PATH && request.method === 'POST') return true
  if (!SAFE_METHODS.has(request.method)) return false

  // OAuth, verification, account-deletion, and checkout callbacks write state
  // despite using GET. Keep this list explicit so a support preview cannot
  // mutate the target account through a link navigation.
  return !(
    pathname === '/api/agent/integrations/google-calendar/authorize'
    || pathname === '/api/agent/integrations/google-calendar/callback'
    || pathname === '/api/auth/verify-email'
    || pathname.startsWith('/api/auth/callback/')
    || pathname === '/api/auth/delete-user/callback'
    || (pathname.startsWith('/api/billing/') && pathname.endsWith('/complete'))
  )
}

function privateLoginRedirect(request: NextRequest, loginPath: '/login' | '/admin/login') {
  const destination = new URL(loginPath, request.url)
  // pathname and search come from Next's parsed request URL, so this can only
  // carry a same-origin path back through the login flow.
  destination.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(destination)
}

export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)
  const pathname = request.nextUrl.pathname
  const requiredModule = getPlatformModuleForPath(pathname)
  const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/')
  const requiresAdminSession = isAdminPage && pathname !== '/admin/login'
  const requiresUserSession = ['/agent', '/client', '/onboarding'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

  if (!sessionCookie && requiresAdminSession) {
    const destination = new URL('/admin/login', request.url)
    destination.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(destination)
  }

  if (!sessionCookie && requiresUserSession) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const mustCheckPreview = Boolean(sessionCookie) && !isSafeDuringPreview(request)
  const mustCheckModule = Boolean(sessionCookie) && requiredModule !== null
  // A present cookie is only a coarse hint. Every protected page validates it
  // here so an expired/deleted Better Auth session takes the user back through
  // login instead of surfacing a generic server authorization error later.
  const mustCheckPrivateSession = Boolean(sessionCookie) && (requiresAdminSession || requiresUserSession)
  const session = mustCheckPreview || mustCheckModule || mustCheckPrivateSession
    ? await auth.api.getSession({ headers: request.headers })
    : null

  if (!session && sessionCookie && requiresAdminSession) {
    return privateLoginRedirect(request, '/admin/login')
  }

  if (!session && sessionCookie && requiresUserSession) {
    return privateLoginRedirect(request, '/login')
  }

  if (mustCheckPreview) {
    if (isReadOnlySupportPreview(session)) {
      return NextResponse.json(
        {
          error: 'READ_ONLY_USER_PREVIEW',
          message: 'Keepr One support preview is read-only.',
        },
        { status: 403 },
      )
    }
  }

  if (requiredModule && session?.user.role === 'AGENT') {
    const agent = await prisma.agent.findUnique({
      where: { userId: session.user.id },
      select: {
        adminProvisionedAccess: {
          select: { modules: true },
        },
        agencyInvitationsAccepted: {
          where: { status: 'ACCEPTED', isCurrentCommercial: true },
          take: 1,
          select: { id: true },
        },
      },
    })
    const managedAccess = agent?.agencyInvitationsAccepted?.length
      ? null
      : agent?.adminProvisionedAccess

    // Absence is the explicit legacy marker; legacy accounts keep their
    // existing surface while only administratively provisioned accounts are
    // constrained by the new module list.
    if (
      managedAccess
      && !normalizePlatformModules(managedAccess.modules).includes(requiredModule)
    ) {
      return moduleDeniedResponse(request, requiredModule)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/:path*',
}
