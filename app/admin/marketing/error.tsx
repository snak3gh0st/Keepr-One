'use client'

import { useI18n } from '@/components/i18n/LanguageProvider'

export default function MarketingError({ reset }: { reset: () => void }) {
  const { copy } = useI18n()
  return <main className="mx-auto max-w-xl px-6 py-20">
    <h1 className="text-2xl font-semibold text-ink">{copy('Não foi possível carregar o Marketing.', 'Unable to load Marketing.')}</h1>
    <p className="my-4 text-sm leading-6 text-ink-muted">{copy('Tente novamente em instantes. Se sua sessão expirou, entre novamente no painel.', 'Please try again shortly. If your session expired, sign in to the admin panel again.')}</p>
    <div className="flex flex-wrap gap-4">
      <button type="button" className="rounded-lg bg-rail px-4 py-3 text-sm font-semibold text-paper" onClick={reset}>{copy('Tentar novamente', 'Try again')}</button>
      <a className="inline-flex min-h-11 items-center text-sm font-semibold text-teal" href="/backoffice/login">{copy('Entrar no painel', 'Sign in to admin')}</a>
    </div>
  </main>
}
