import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { sanitizeAdminRedirectPath, portalHomeForRole } from '@/lib/auth-navigation'
import { getCurrentSession, getServerI18n } from '@/lib/i18n/server'
import { AdminLoginForm } from './AdminLoginForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { copy } = await getServerI18n()
  return {
    title: copy('Login administrativo', 'Admin sign in'),
    description: copy(
      'Acesso exclusivo ao backoffice da Keepr One.',
      'Exclusive access to the Keepr One back office.',
    ),
    robots: { index: false, follow: false },
  }
}

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [params, session] = await Promise.all([
    searchParams,
    getCurrentSession(),
  ])
  const redirectTo = sanitizeAdminRedirectPath(firstString(params.next))
  const role = session?.user.role as unknown

  if (role === 'ADMIN') redirect(redirectTo)

  const activeSession = session && (role === 'AGENT' || role === 'CLIENT')
    ? {
        name: session.user.name,
        email: session.user.email,
        role: role as 'AGENT' | 'CLIENT',
        portalHref: portalHomeForRole(role),
      }
    : null

  return <AdminLoginForm redirectTo={redirectTo} initialActiveSession={activeSession} />
}
