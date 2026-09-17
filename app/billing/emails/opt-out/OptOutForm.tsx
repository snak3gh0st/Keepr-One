'use client'

import { useActionState } from 'react'
import { optOutOfRetentionEmailsAction, type OptOutState } from './actions'

const INITIAL: OptOutState = { status: 'idle', message: '' }

export function OptOutForm({
  subscriptionId,
  token,
  language,
}: {
  subscriptionId: string
  token: string
  language: 'PT' | 'EN'
}) {
  const [state, action, pending] = useActionState(optOutOfRetentionEmailsAction, INITIAL)
  const copy = (portuguese: string, english: string) =>
    language === 'PT' ? portuguese : english

  if (state.status === 'done') {
    return (
      <p className="mt-6 rounded-lg border border-border-steel bg-panel px-4 py-3 text-sm text-ink">
        {copy(
          'Pronto. Você não receberá mais estes lembretes de assinatura.',
          'Done. You will no longer receive these subscription reminders.',
        )}
      </p>
    )
  }

  return (
    <form action={action}>
      <input type="hidden" name="s" value={subscriptionId} />
      <input type="hidden" name="t" value={token} />

      {state.status === 'error' && (
        <p className="mt-5 rounded-lg border border-gold/25 bg-gold-pale px-4 py-3 text-sm text-gold-ink">
          {copy(
            'Este link não é mais válido. Se quiser parar de receber, responda ao e-mail que enviamos.',
            'This link is no longer valid. If you want to stop receiving these, reply to the email we sent.',
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 flex min-h-12 w-full items-center justify-center rounded-full bg-rail-strong px-5 text-sm font-semibold text-paper transition-colors hover:bg-rail disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
      >
        {pending
          ? copy('Cancelando...', 'Unsubscribing...')
          : copy('Confirmar e parar de receber', 'Confirm and stop receiving')}
      </button>
    </form>
  )
}
