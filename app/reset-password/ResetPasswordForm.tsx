'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/Button'
import { Field, Input } from '@/components/Field'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { authClient } from '@/lib/auth-client'

export function ResetPasswordForm({
  token,
  tokenError,
  portal = 'user',
}: {
  token: string
  tokenError: boolean
  portal?: 'admin' | 'user'
}) {
  const { copy, language } = useI18n()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestEmail, setRequestEmail] = useState('')
  const [requestSent, setRequestSent] = useState(false)
  const returnTo = portal === 'admin' ? '/admin/login' : '/login'
  const resetDestination = portal === 'admin'
    ? `/reset-password?lang=${language}&portal=admin`
    : `/reset-password?lang=${language}`

  async function handleNewLinkRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !requestEmail) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await authClient.requestPasswordReset({
        email: requestEmail,
        redirectTo: resetDestination,
      })
      if (result.error) throw new Error(result.error.message)
      setRequestSent(true)
    } catch {
      setError(copy('Não foi possível solicitar um novo link agora.', 'We could not request a new link right now.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || complete || !token) return
    if (password.length < 8 || password.length > 128) {
      setError(copy('Use uma senha entre 8 e 128 caracteres.', 'Use a password between 8 and 128 characters.'))
      return
    }
    if (password !== confirmation) {
      setError(copy('As senhas precisam ser iguais.', 'The passwords must match.'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const result = await authClient.resetPassword({ newPassword: password, token })
      if (result.error) {
        setError(copy(
          'Não foi possível usar este link. Ele pode ter expirado ou já ter sido utilizado.',
          'We could not use this link. It may have expired or already been used.',
        ))
        return
      }
      setPassword('')
      setConfirmation('')
      setComplete(true)
    } catch {
      setError(copy('Não foi possível redefinir a senha agora.', 'We could not reset your password right now.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (complete) {
    return (
      <div className="py-4 text-center" role="status" aria-live="polite">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-pale text-xl font-semibold text-success" aria-hidden>✓</span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-ink">
          {copy('Senha atualizada', 'Password updated')}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-muted">
          {copy(
            'Todas as sessões anteriores foram encerradas. Entre novamente usando sua nova senha.',
            'All previous sessions were revoked. Sign in again with your new password.',
          )}
        </p>
        <Link href={returnTo} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-rail-strong px-5 py-2.5 text-sm font-semibold text-paper hover:bg-rail">
          {copy('Ir para o acesso', 'Go to sign in')} →
        </Link>
      </div>
    )
  }

  if (tokenError || !token) {
    return (
      <form onSubmit={handleNewLinkRequest} className="space-y-5">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-teal">
            {copy('Segurança da conta', 'Account security')}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
            {copy('Solicite um novo link', 'Request a new link')}
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            {copy(
              'Este link é inválido ou expirou. Informe seu e-mail e enviaremos uma nova redefinição se a conta existir.',
              'This link is invalid or expired. Enter your email and we will send a new reset if the account exists.',
            )}
          </p>
        </div>

        {requestSent ? (
          <p className="rounded-lg bg-success-pale px-3.5 py-3 text-sm leading-6 text-success" role="status">
            {copy('Se este e-mail estiver cadastrado, o novo link chegará em instantes.', 'If this email is registered, a new link will arrive shortly.')}
          </p>
        ) : (
          <Field label={copy('E-mail da conta', 'Account email')} htmlFor="reset-request-email" required>
            <Input
              id="reset-request-email"
              type="email"
              value={requestEmail}
              onChange={(event) => setRequestEmail(event.target.value)}
              maxLength={254}
              autoComplete="email"
              required
              disabled={submitting}
              className="w-full"
            />
          </Field>
        )}

        {error ? <p className="rounded-lg bg-danger-pale px-3.5 py-3 text-sm text-danger" role="alert">{error}</p> : null}
        {!requestSent ? (
          <Button type="submit" variant="primary" disabled={submitting} aria-busy={submitting} className="w-full">
            {submitting ? copy('Enviando…', 'Sending…') : copy('Enviar novo link', 'Send new link')}
          </Button>
        ) : null}
        <p className="text-center text-xs text-ink-muted">
          <Link href={returnTo} className="font-semibold text-teal hover:text-teal-deep">
            {copy('Voltar para o acesso', 'Back to sign in')}
          </Link>
        </p>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-teal">
          {copy('Segurança da conta', 'Account security')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
          {copy('Crie uma nova senha', 'Create a new password')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          {copy(
            'Use pelo menos 8 caracteres. Ao concluir, as sessões antigas serão encerradas.',
            'Use at least 8 characters. When complete, old sessions will be revoked.',
          )}
        </p>
      </div>

      <Field label={copy('Nova senha', 'New password')} htmlFor="new-password" required>
        <Input
          id="new-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          required
          disabled={!token || tokenError || submitting}
          className="w-full"
        />
      </Field>
      <Field label={copy('Confirme a senha', 'Confirm password')} htmlFor="confirm-password" required>
        <Input
          id="confirm-password"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          required
          disabled={!token || tokenError || submitting}
          className="w-full"
        />
      </Field>

      {error ? <p className="rounded-lg bg-danger-pale px-3.5 py-3 text-sm text-danger" role="alert">{error}</p> : null}

      <Button
        type="submit"
        variant="primary"
        disabled={submitting || !token || tokenError}
        aria-busy={submitting}
        className="w-full"
      >
        {submitting ? copy('Atualizando…', 'Updating…') : copy('Atualizar senha', 'Update password')}
      </Button>

      <p className="text-center text-xs text-ink-muted">
        <Link href={returnTo} className="font-semibold text-teal hover:text-teal-deep">
          {copy('Voltar para o acesso', 'Back to sign in')}
        </Link>
      </p>
    </form>
  )
}
