'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Logo } from '@/components/Logo'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { authClient } from '@/lib/auth-client'

type ActiveUserSession = {
  name: string
  email: string
  role: 'AGENT' | 'CLIENT'
  portalHref: string
}

function EyeIcon({ crossed = false }: { crossed?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M2.7 12s3.3-5 9.3-5 9.3 5 9.3 5-3.3 5-9.3 5-9.3-5-9.3-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.35" stroke="currentColor" strokeWidth="1.5" />
      {crossed ? (
        <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : null}
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="m5 10.25 3.1 3.1L15.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AdminLoginForm({
  redirectTo,
  initialActiveSession = null,
}: {
  redirectTo: string
  initialActiveSession?: ActiveUserSession | null
}) {
  const router = useRouter()
  const { copy } = useI18n()
  const [activeSession, setActiveSession] = useState(initialActiveSession)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function clearError() {
    if (error) setError(null)
  }

  async function handleSessionExit() {
    if (switchingAccount) return
    setSwitchingAccount(true)
    setError(null)

    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error(result.error.message)
      setActiveSession(null)
      router.refresh()
    } catch {
      setError(copy(
        'Não foi possível encerrar a sessão atual. Tente novamente.',
        'We could not end the current session. Please try again.',
      ))
    } finally {
      setSwitchingAccount(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || activeSession) return

    setSubmitting(true)
    setError(null)

    try {
      const result = await authClient.signIn.email({ email, password })
      if (result.error) {
        setError(copy(
          'Não foi possível entrar. Confira seu e-mail e sua senha.',
          "We couldn't sign you in. Check your email and password.",
        ))
        return
      }

      const role = (result.data?.user as { role?: unknown } | undefined)?.role
      if (role !== 'ADMIN') {
        try {
          await authClient.signOut()
        } catch {
          // The server-side ADMIN role gate remains authoritative even if a
          // best-effort cleanup cannot reach the auth endpoint.
        }
        setError(copy(
          'Esta conta não possui acesso administrativo.',
          'This account does not have administrative access.',
        ))
        return
      }

      router.replace(redirectTo)
      router.refresh()
    } catch {
      setError(copy(
        'A conexão falhou. Tente novamente em alguns instantes.',
        'The connection failed. Please try again in a moment.',
      ))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="keepr-grid min-h-[100svh] bg-canvas px-4 py-5 text-ink sm:px-6 sm:py-8 lg:flex lg:items-center">
      <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-border-steel bg-paper lg:grid lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <section className="flex min-h-[300px] flex-col bg-rail-strong px-6 py-7 text-paper sm:px-9 sm:py-9 lg:min-h-[650px] lg:px-11 lg:py-10">
          <header className="flex items-center justify-between gap-4">
            <Logo size={31} className="text-lg text-white" />
            <span className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-white/70">
              {copy('Uso interno', 'Internal use')}
            </span>
          </header>

          <div className="my-auto py-10 lg:py-8">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-mint">
              {copy('Acesso administrativo', 'Administrative access')}
            </p>
            <h1 className="mt-4 max-w-sm text-3xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-4xl">
              {copy('Painel administrativo', 'Admin console')}
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/68">
              {copy(
                'Área exclusiva para gestores da Keepr One administrarem a plataforma e seus usuários.',
                'Exclusive to Keepr One managers administering the platform and its users.',
              )}
            </p>

            <ul className="mt-8 max-w-sm border-y border-white/12 py-2" aria-label={copy('Escopo do painel', 'Console scope')}>
              <li className="flex items-center gap-3 border-b border-white/10 py-3 text-sm text-white/82">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/8 text-mint"><CheckIcon /></span>
                {copy('Visão geral da plataforma', 'Platform overview')}
              </li>
              <li className="flex items-center gap-3 py-3 text-sm text-white/82">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/8 text-mint"><CheckIcon /></span>
                {copy('Usuários, planos e acessos', 'Users, plans, and access')}
              </li>
            </ul>
          </div>

          <p className="text-xs leading-5 text-white/52">
            {copy(
              'As ações administrativas são identificadas e registradas para segurança.',
              'Administrative actions are identified and logged for security.',
            )}
          </p>
        </section>

        <section aria-labelledby="admin-sign-in-title" className="flex min-h-[520px] flex-col bg-paper px-6 py-7 sm:px-10 sm:py-10 lg:min-h-[650px] lg:px-14 lg:py-10">
          <header className="flex items-center justify-between gap-5 border-b border-border-steel pb-5">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Keepr One · Admin
            </span>
            <Link href="/login" className="text-xs font-semibold text-teal hover:text-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale">
              {copy('Área de usuários', 'User sign-in')} <span aria-hidden>→</span>
            </Link>
          </header>

          <div className="my-auto w-full max-w-md self-center py-9">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-teal">
              {copy('Backoffice Keepr One', 'Keepr One back office')}
            </p>
            <h2 id="admin-sign-in-title" className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-ink sm:text-3xl">
              {copy('Acesse o backoffice', 'Sign in to the back office')}
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              {copy(
                'Use as credenciais da sua conta administrativa.',
                'Use your administrative account credentials.',
              )}
            </p>

            {activeSession ? (
              <div className="mt-7 rounded-lg border border-gold/35 bg-gold-pale p-4" role="status">
                <p className="text-sm font-semibold text-ink">
                  {copy('Uma conta de usuário já está conectada', 'A user account is already signed in')}
                </p>
                <p className="mt-1 text-sm leading-6 text-ink-muted">
                  {activeSession.name} · {activeSession.email}
                </p>
                <p className="mt-2 text-xs leading-5 text-gold-ink">
                  {copy(
                    'Encerre esta sessão antes de usar uma conta administrativa.',
                    'End this session before using an administrative account.',
                  )}
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void handleSessionExit()}
                    disabled={switchingAccount}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-teal px-4 text-sm font-semibold text-paper transition-colors hover:bg-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale disabled:cursor-wait disabled:opacity-60"
                  >
                    {switchingAccount
                      ? copy('Encerrando sessão…', 'Signing out…')
                      : copy('Sair e usar acesso administrativo', 'Sign out and use admin access')}
                  </button>
                  <Link
                    href={activeSession.portalHref}
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-steel bg-paper px-4 text-sm font-semibold text-ink hover:border-teal focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
                  >
                    {copy('Voltar ao painel atual', 'Return to current portal')}
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} aria-busy={submitting} className="mt-7 space-y-5">
                <label htmlFor="admin-login-email" className="block">
                  <span className="mb-2 block text-xs font-semibold text-ink">
                    {copy('E-mail corporativo', 'Work email')}
                  </span>
                  <input
                    id="admin-login-email"
                    type="email"
                    name="email"
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); clearError() }}
                    required
                    disabled={submitting}
                    autoComplete="email"
                    inputMode="email"
                    maxLength={254}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'admin-login-error' : undefined}
                    placeholder={copy('gestor@keeprone.com', 'manager@keeprone.com')}
                    className="h-12 w-full rounded-md border border-border-steel bg-paper px-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-muted/70 hover:border-teal/60 focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale disabled:cursor-wait disabled:bg-panel"
                  />
                </label>

                <div className="block">
                  <span className="mb-2 flex items-center justify-between gap-4 text-xs font-semibold text-ink">
                    <label htmlFor="admin-login-password">{copy('Senha', 'Password')}</label>
                    <Link href="/reset-password?portal=admin" className="font-semibold text-teal hover:text-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale">
                      {copy('Esqueci minha senha', 'Forgot password')}
                    </Link>
                  </span>
                  <span className="relative block">
                    <input
                      id="admin-login-password"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={password}
                      onChange={(event) => { setPassword(event.target.value); clearError() }}
                      required
                      disabled={submitting}
                      minLength={8}
                      maxLength={128}
                      autoComplete="current-password"
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'admin-login-error' : undefined}
                      placeholder={copy('Digite sua senha', 'Enter your password')}
                      className="h-12 w-full rounded-md border border-border-steel bg-paper px-3.5 pr-12 text-base text-ink outline-none transition-colors placeholder:text-ink-muted/70 hover:border-teal/60 focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale disabled:cursor-wait disabled:bg-panel"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword
                        ? copy('Ocultar senha', 'Hide password')
                        : copy('Mostrar senha', 'Show password')}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 grid min-h-11 w-12 place-items-center text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-teal-pale"
                    >
                      <EyeIcon crossed={showPassword} />
                    </button>
                  </span>
                </div>

                {error ? (
                  <p id="admin-login-error" role="alert" aria-live="polite" className="rounded-lg border border-danger/25 bg-danger-pale px-4 py-3 text-sm leading-6 text-danger">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-12 w-full items-center justify-center rounded-md bg-teal px-5 text-sm font-semibold text-paper transition-colors hover:bg-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale disabled:cursor-wait disabled:opacity-60"
                >
                  {submitting
                    ? copy('Verificando acesso…', 'Checking access…')
                    : copy('Entrar no painel', 'Sign in to admin')}
                </button>
              </form>
            )}

            {error && activeSession ? (
              <p id="admin-session-error" role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger-pale px-4 py-3 text-sm leading-6 text-danger">
                {error}
              </p>
            ) : null}
          </div>

          <footer className="border-t border-border-steel pt-5 text-xs leading-5 text-ink-muted">
            {copy(
              'Problemas para acessar? Solicite suporte a outro administrador.',
              'Trouble signing in? Ask another administrator for support.',
            )}
          </footer>
        </section>
      </div>
    </main>
  )
}
