import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from '@/lib/require-role'

export default async function Home() {
  // Only the session lookup goes in try/catch. redirect() throws a special
  // NEXT_REDIRECT signal that Next.js's router must see — catching it here
  // (by wrapping the redirect() calls themselves in the try) would silently
  // swallow the redirect and fall through to the guest landing page below,
  // which is exactly the "login works but bounces back to /" bug this
  // comment replaced.
  let role: string | null = null
  try {
    const session = await requireRole('ADMIN', 'AGENT', 'CLIENT')
    role = session.user.role
  } catch {
    // Not signed in — fall through to the guest landing page.
  }

  if (role === 'ADMIN') redirect('/admin')
  if (role === 'AGENT') redirect('/agent')
  if (role === 'CLIENT') redirect('/client')

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center px-4 text-center">
      <span className="font-sans text-2xl font-semibold tracking-tight text-ink">
        Keepr One
      </span>
      <p className="mt-2 text-sm text-ink-muted">
        Acesse sua conta para ver suas apólices e comissões.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
      >
        Entrar
      </Link>
    </main>
  )
}
