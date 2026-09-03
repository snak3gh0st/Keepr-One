import { Logo } from '@/components/Logo'
import { LanguageProvider } from '@/components/i18n/LanguageProvider'
import { ResetPasswordForm } from './ResetPasswordForm'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const tokenValue = Array.isArray(params.token) ? params.token[0] : params.token
  const errorValue = Array.isArray(params.error) ? params.error[0] : params.error
  const portalValue = Array.isArray(params.portal) ? params.portal[0] : params.portal
  const token = typeof tokenValue === 'string' ? tokenValue : ''
  const language = params.lang === 'EN' ? 'EN' : 'PT'
  const portal = portalValue === 'admin' ? 'admin' : 'user'

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas px-4 py-8 sm:px-6">
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col">
        <header className="flex items-center justify-between border-b border-border-steel pb-5">
          <Logo className="text-ink" />
          <span className="font-mono text-xs uppercase tracking-[0.12em] text-ink-muted">Keepr One</span>
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <section className="w-full max-w-md rounded-xl border border-border-steel bg-paper p-6 shadow-[0_22px_70px_rgba(8,20,14,0.08)] sm:p-8">
            <LanguageProvider initialLanguage={language}>
              <ResetPasswordForm token={token} tokenError={Boolean(errorValue)} portal={portal} />
            </LanguageProvider>
          </section>
        </div>

        <footer className="border-t border-border-steel pt-5 text-center text-xs text-ink-muted">
          © {new Date().getFullYear()} Keepr One · {language === 'PT' ? 'Recuperação segura da conta' : 'Secure account recovery'}
        </footer>
      </div>
    </main>
  )
}
