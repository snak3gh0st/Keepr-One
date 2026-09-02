'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { useI18n } from '@/components/i18n/LanguageProvider'

export function FounderSignOutButton() {
  const { copy } = useI18n()
  const [pending, setPending] = useState(false)

  async function signOut() {
    if (pending) return
    setPending(true)
    try {
      await authClient.signOut()
      window.location.assign('/login')
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="min-h-11 border-b border-white/35 text-xs font-semibold text-white/64 transition-colors hover:border-mint hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mint disabled:opacity-50"
    >
      {pending
        ? copy('Saindo…', 'Signing out…')
        : copy('Entrar com outra conta', 'Sign in with another account')}
    </button>
  )
}
