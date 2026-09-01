'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/Button'
import { Field, Input } from '@/components/Field'
import type { NationalLifeCredentialSummary } from '@/lib/national-life/credentials/settings-service'
import {
  revokeNationalLifeCredentialAction,
  saveNationalLifeCredentialAction,
} from './credential-actions'
import { INITIAL_SETTINGS_ACTION_STATE, type SettingsActionState } from './state'

export type KBotCredentialSettingsProps = Readonly<{
  connectorEnabled: boolean
  credentialBrokerEnabled: boolean
  summary: NationalLifeCredentialSummary
}>

function fieldError(state: SettingsActionState, name: string) {
  return state.fieldErrors?.[name]
}

function ActionMessage({ state, id }: { state: SettingsActionState; id: string }) {
  if (!state.message) return null
  return (
    <p
      id={id}
      role={state.status === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={`text-sm ${state.status === 'error' ? 'text-danger' : 'text-success'}`}
    >
      {state.message}
    </p>
  )
}

function PendingButton({ label, pendingLabel, variant = 'primary' }: {
  label: string
  pendingLabel: string
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </Button>
  )
}

function ManualLoginGuidance({ connectorEnabled }: { connectorEnabled: boolean }) {
  return (
    <div className="grid gap-4 rounded-2xl border border-border-steel bg-panel p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <p className="text-sm font-semibold text-ink">
          {connectorEnabled
            ? 'K-Bot está disponível neste ambiente'
            : 'K-Bot não está disponível neste ambiente'}
        </p>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-muted">
          O Keepr One não guarda nem envia sua senha da National Life. Quando a sessão expira,
          o K-Bot abre a página oficial; depois do seu login manual, retoma o mesmo pedido automaticamente.
        </p>
        <p className="mt-3 max-w-2xl text-xs leading-5 text-ink-muted">
          A National Life continua controlando MFA e a duração da sessão. Se MFA for solicitado,
          o K-Bot sempre pausa para você concluir a verificação.
        </p>
      </div>
      <Link
        href="/agent/integrations/national-life"
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-steel bg-paper px-4 text-sm font-semibold text-ink hover:border-ink-muted"
      >
        Gerenciar K-Bot e National Life
      </Link>
    </div>
  )
}

function SaveCredentialForm({ onCancel }: { onCancel?: () => void }) {
  const [state, action] = useActionState(
    saveNationalLifeCredentialAction,
    INITIAL_SETTINGS_ACTION_STATE,
  )
  const usernameError = fieldError(state, 'username')
  const nationalLifePasswordError = fieldError(state, 'nationalLifePassword')
  const keeprOnePasswordError = fieldError(state, 'keeprOnePassword')
  const consentError = fieldError(state, 'consent')

  return (
    <form action={action} className="rounded-2xl border border-border-steel bg-panel p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Usuário da National Life" htmlFor="kbot-carrier-username" error={usernameError} required>
          <Input
            id="kbot-carrier-username"
            name="username"
            type="text"
            autoComplete="username"
            maxLength={128}
            required
            aria-invalid={Boolean(usernameError)}
          />
        </Field>
        <Field label="Senha da National Life" htmlFor="kbot-carrier-password" error={nationalLifePasswordError} required>
          <Input
            id="kbot-carrier-password"
            name="nationalLifePassword"
            type="password"
            autoComplete="new-password"
            maxLength={256}
            required
            aria-invalid={Boolean(nationalLifePasswordError)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="Senha atual do Keepr One"
            htmlFor="kbot-keeprone-password"
            hint="Confirma que é você antes de substituir a credencial protegida."
            error={keeprOnePasswordError}
            required
          >
            <Input
              id="kbot-keeprone-password"
              name="keeprOnePassword"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
              aria-invalid={Boolean(keeprOnePasswordError)}
            />
          </Field>
        </div>
      </div>

      <label className="mt-5 flex items-start gap-3 rounded-xl border border-border-steel bg-paper p-4 text-sm leading-6 text-ink">
        <input
          type="checkbox"
          name="consent"
          className="mt-1 size-4"
          aria-invalid={Boolean(consentError)}
          required
        />
        <span>
          Autorizo o Keepr One a proteger esta credencial e o K-Bot a usá-la somente para
          uma tentativa de login quando a sessão da National Life expirar. MFA e CAPTCHA continuarão manuais.
          {consentError ? <span className="mt-1 block text-danger">{consentError}</span> : null}
        </span>
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border-steel pt-5">
        <PendingButton label="Proteger credencial" pendingLabel="Protegendo…" />
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        ) : null}
        <ActionMessage state={state} id="kbot-credential-save-message" />
      </div>
    </form>
  )
}

function RevokeCredentialForm() {
  const [state, action] = useActionState(
    revokeNationalLifeCredentialAction,
    INITIAL_SETTINGS_ACTION_STATE,
  )
  const passwordError = fieldError(state, 'keeprOnePassword')
  return (
    <form action={action} className="mt-5 border-t border-border-steel pt-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,320px)_auto] sm:items-end">
        <Field
          label="Senha atual do Keepr One para remover"
          htmlFor="kbot-revoke-password"
          error={passwordError}
          required
        >
          <Input
            id="kbot-revoke-password"
            name="keeprOnePassword"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
            aria-invalid={Boolean(passwordError)}
          />
        </Field>
        <PendingButton label="Remover credencial" pendingLabel="Removendo…" variant="danger" />
      </div>
      <div className="mt-3"><ActionMessage state={state} id="kbot-credential-revoke-message" /></div>
    </form>
  )
}

const statusLabels = {
  NOT_CONFIGURED: 'Não configurada',
  UNTESTED: 'Aguardando primeiro uso',
  READY: 'Pronta',
  REJECTED: 'Precisa ser substituída',
  REVOKED: 'Removida',
} as const

function formatDate(value: string | null) {
  if (!value) return 'Ainda não ocorreu'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function KBotCredentialSettings({
  connectorEnabled,
  credentialBrokerEnabled,
  summary,
}: KBotCredentialSettingsProps) {
  const [replacing, setReplacing] = useState(false)

  if (!credentialBrokerEnabled) {
    return <ManualLoginGuidance connectorEnabled={connectorEnabled} />
  }

  if (!summary.configured && summary.status !== 'REVOKED') {
    return <SaveCredentialForm />
  }

  return (
    <div className="rounded-2xl border border-border-steel bg-panel p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Credencial protegida
          </p>
          <p className="mt-2 text-base font-semibold text-ink">{summary.maskedUsername ?? 'Identidade removida'}</p>
          <p className="mt-1 text-sm text-ink-muted">{statusLabels[summary.status]}</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setReplacing(true)}>
          Substituir credencial
        </Button>
      </div>

      {summary.status === 'REJECTED' ? (
        <p className="mt-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm leading-6 text-danger">
          O K-Bot tentou uma vez e parou. Para evitar bloqueio na National Life, não haverá retry automático;
          substitua a credencial antes do próximo login.
        </p>
      ) : null}

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-ink-muted">Último login concluído</dt>
          <dd className="mt-1 text-sm text-ink">{formatDate(summary.lastSucceededAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-muted">Última rejeição</dt>
          <dd className="mt-1 text-sm text-ink">{formatDate(summary.lastRejectedAt)}</dd>
        </div>
      </dl>

      {replacing ? (
        <div className="mt-5"><SaveCredentialForm onCancel={() => setReplacing(false)} /></div>
      ) : null}
      <RevokeCredentialForm />
    </div>
  )
}
