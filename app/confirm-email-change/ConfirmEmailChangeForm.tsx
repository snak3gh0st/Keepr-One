'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/Button'
import { useI18n } from '@/components/i18n/LanguageProvider'
import {
  confirmAdminEmailChangeAction,
  type ConfirmEmailChangeActionState,
} from './actions'

const INITIAL_CONFIRM_EMAIL_CHANGE_FORM_STATE: ConfirmEmailChangeActionState = {
  status: 'idle',
  message: '',
}

function ConfirmButton() {
  const { copy } = useI18n()
  const status = useFormStatus()
  return (
    <Button
      type="submit"
      variant="primary"
      disabled={status.pending}
      aria-busy={status.pending}
      className="w-full"
    >
      {status.pending
        ? copy('Confirmando…', 'Confirming…')
        : copy('Continuar confirmação', 'Continue confirmation')}
    </Button>
  )
}

export function ConfirmEmailChangeForm({
  token,
  language,
}: {
  token: string
  language: 'PT' | 'EN'
}) {
  const { copy } = useI18n()
  const [state, action] = useActionState(
    confirmAdminEmailChangeAction,
    INITIAL_CONFIRM_EMAIL_CHANGE_FORM_STATE,
  )

  if (state.status === 'success' && state.completed) {
    return (
      <div className="py-4 text-center" role="status" aria-live="polite">
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-pale text-xl font-semibold text-success"
          aria-hidden
        >
          ✓
        </span>
        <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-teal">
          {copy('Identidade confirmada', 'Identity confirmed')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
          {copy('E-mail atualizado', 'Email updated')}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-muted">
          {state.message}
        </p>
        {state.loginEmail ? (
          <p className="mt-4 rounded-lg bg-panel px-3.5 py-3 font-mono text-xs text-ink">
            {state.loginEmail}
          </p>
        ) : null}
        <Link
          href="/login"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-rail-strong px-5 py-2.5 text-sm font-semibold text-paper hover:bg-rail"
        >
          {copy('Entrar novamente', 'Sign in again')} →
        </Link>
      </div>
    )
  }

  if (state.status === 'success') {
    return (
      <div className="py-4 text-center" role="status" aria-live="polite">
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-pale text-xl font-semibold text-success"
          aria-hidden
        >
          1/2
        </span>
        <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-teal">
          {copy('Endereço atual autorizado', 'Current address authorized')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
          {copy('Confira o novo e-mail', 'Check the new inbox')}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-muted">
          {state.message}
        </p>
        <p className="mt-5 rounded-lg bg-panel px-3.5 py-3 text-xs leading-5 text-ink-muted">
          {copy(
            'Nenhum dado da conta mudou ainda. A troca só termina no segundo link.',
            'No account data has changed yet. The second link completes the change.',
          )}
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="language" value={language} />
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-teal">
          {copy('Segurança da conta', 'Account security')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
          {copy('Confirme a troca de e-mail', 'Confirm the email change')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          {copy(
            'A troca exige autorização do e-mail atual e do novo. Somente depois das duas etapas este endereço passa a ser o login e todos os dispositivos são desconectados.',
            'The change requires approval from both the current and new addresses. Only after both steps does this address become the login and every device is signed out.',
          )}
        </p>
      </div>

      {state.status === 'error' ? (
        <p className="rounded-lg bg-danger-pale px-3.5 py-3 text-sm leading-6 text-danger" role="alert">
          {state.message}
        </p>
      ) : null}

      {state.status === 'idle' || state.canRetry ? <ConfirmButton /> : null}
      <p className="text-center text-xs leading-5 text-ink-muted">
        {copy(
          'Não reconhece esta solicitação? Não confirme e fale com o suporte do Keepr One.',
          'Do not recognize this request? Do not confirm it and contact Keepr One support.',
        )}
      </p>
    </form>
  )
}
