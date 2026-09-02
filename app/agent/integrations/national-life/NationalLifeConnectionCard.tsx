'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import type { AgentSessionSummary } from '@/lib/national-life/interactive-connection-service'
import {
  disconnectNationalLifeConnection,
  startNationalLifeConnection,
} from './actions'
import { NationalLifeBrowserModal } from './NationalLifeBrowserModal'
import type { ActiveNationalLifeAttempt } from './useNationalLifeConnectionAttempt'
import { useI18n } from '@/components/i18n/LanguageProvider'

type SerializableSessionSummary = Omit<
  AgentSessionSummary,
  'lastConnectedAt' | 'lastUsedAt' | 'carrierExpiresAt' | 'illustrationSsoCheckedAt'
> & {
  lastConnectedAt: Date | string
  lastUsedAt: Date | string | null
  carrierExpiresAt: Date | string | null
  illustrationSsoCheckedAt: Date | string | null
}

function formatDateTime(value: Date | string | null, locale: string) {
  if (!value) {
    return '—'
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export function NationalLifeConnectionCard({
  summary,
}: {
  summary: SerializableSessionSummary | null
}) {
  const { copy, locale } = useI18n()
  const router = useRouter()
  const [attempt, setAttempt] = useState<ActiveNationalLifeAttempt | null>(null)
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const [message, setMessage] = useState<{
    kind: 'success' | 'error'
    text: string
  } | null>(null)

  async function handleConnect() {
    setBusy('connect')
    setMessage(null)
    try {
      const result = await startNationalLifeConnection()
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.message })
        return
      }
      setAttempt({
        attemptId: result.attemptId,
        initialState: result.state,
        expiresAt: result.expiresAt,
      })
    } finally {
      setBusy(null)
    }
  }

  async function handleDisconnect() {
    setBusy('disconnect')
    setMessage(null)
    try {
      const result = await disconnectNationalLifeConnection()
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.message })
        return
      }
      setMessage({ kind: 'success', text: copy('National Life desconectada.', 'National Life disconnected.') })
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  function handleAuthenticated() {
    setAttempt(null)
    setMessage({ kind: 'success', text: copy('National Life conectada', 'National Life connected') })
    router.refresh()
  }

  function handleClosed(text: string) {
    setAttempt(null)
    setMessage({ kind: 'error', text })
  }

  const connected = summary?.status === 'CONNECTED'

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-border-steel bg-paper shadow-[var(--shadow-card)]">
        <div className="flex flex-col gap-5 border-b border-border-steel p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-rail-strong text-lg font-semibold text-mint">
                NL
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">
                  National Life
                </h2>
                <p className="text-sm text-ink-muted">{copy('Portal do agente', 'Agent portal')}</p>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-ink-muted">
              {copy(
                'Entre no portal oficial da National Life. Por padrão, a Keepr One mantém apenas a sessão autenticada. O armazenamento protegido de credenciais é opcional e pode ser ativado ou revogado nas Configurações.',
                'Sign in on the official National Life portal. Keepr One keeps the signed-in session by default. Protected credential storage is optional and can be enabled or revoked under Settings.',
              )}
            </p>
            <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="h-2 w-2 rounded-full bg-success" />
              {copy('O login protegido do K-Bot é sempre opcional', 'Protected K-Bot sign-in is always opt-in')}
            </p>
          </div>

          <span
            className={`inline-flex w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${
              connected
                ? 'bg-success/10 text-success'
                : summary
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-panel text-ink-muted'
            }`}
          >
            {connected ? copy('Conectado', 'Connected') : summary ? copy('Reconexão necessária', 'Reconnect needed') : copy('Não conectado', 'Not connected')}
          </span>
        </div>

        {summary && (
          <dl className="grid divide-y divide-border-steel border-b border-border-steel sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="px-5 py-4 sm:px-6">
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {copy('Última conexão', 'Last connected')}
              </dt>
              <dd className="mt-2 font-mono text-sm text-ink">
                {formatDateTime(summary.lastConnectedAt, locale)}
              </dd>
            </div>
            <div className="px-5 py-4 sm:px-6">
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {copy('Última verificação', 'Last checked')}
              </dt>
              {/* Written only after an authenticated page answered, so this is a
                  successful check and not merely the last attempt. It replaced a
                  "Validade da sessão" that was showing Cloudflare's 30-minute bot
                  cookie: the portal answered authenticated three minutes past it.
                  No cookie predicts when the session dies — only a check. */}
              <dd className="mt-2 font-mono text-sm text-ink">
                {formatDateTime(summary.lastUsedAt, locale)}
              </dd>
            </div>
            <div className="px-5 py-4 sm:px-6">
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {copy('Ilustrações (Foresight)', 'Illustrations (Foresight)')}
              </dt>
              {/* The PDF path sits behind the carrier's Auth0 tenant, which dies
                  while the portal session lives. Knowing before clicking beats
                  finding out at the login wall. Null is its own answer: nothing
                  has crossed the jump, which is not the same as unreachable. */}
              <dd
                className={`mt-2 font-mono text-sm ${
                  summary.illustrationSsoReachable === false ? 'text-gold' : 'text-ink'
                }`}
              >
                {summary.illustrationSsoReachable === null
                  ? copy('Ainda não verificado', 'Not checked yet')
                  : summary.illustrationSsoReachable
                    ? copy('Disponível', 'Available')
                    : copy('Entre novamente', 'Sign in again')}
              </dd>
              {summary.illustrationSsoCheckedAt && (
                <p className="mt-1 text-xs text-ink-muted">
                  {copy('em {date}', 'on {date}', { date: formatDateTime(summary.illustrationSsoCheckedAt, locale) })}
                </p>
              )}
            </div>
          </dl>
        )}

        <div className="flex flex-col gap-3 bg-panel/55 p-5 sm:flex-row sm:items-center sm:p-6">
          {!connected && (
            <Button
              type="button"
              variant="primary"
              disabled={busy !== null}
              onClick={handleConnect}
            >
              {busy === 'connect' ? copy('Abrindo sessão segura...', 'Opening secure session...') : copy('Conectar National Life', 'Connect National Life')}
            </Button>
          )}
          {summary && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null}
              onClick={handleDisconnect}
            >
              {busy === 'disconnect' ? copy('Desconectando...', 'Disconnecting...') : copy('Desconectar', 'Disconnect')}
            </Button>
          )}
          {connected && (
            <Link
              href="/agent/integrations/national-life/data"
              className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
            >
              {copy('Ver dados sincronizados', 'View synced data')}
            </Link>
          )}
          {message && (
            <p
              role="status"
              className={`text-sm ${
                message.kind === 'success' ? 'text-success' : 'text-danger'
              }`}
            >
              {message.text}
              {message.kind === 'error' && !connected && (
                <span className="ml-1">{copy('Você pode conectar novamente a qualquer momento.', 'You can connect again at any time.')}</span>
              )}
            </p>
          )}
        </div>
      </section>

      {attempt && (
        <NationalLifeBrowserModal
          attempt={attempt}
          onAuthenticated={handleAuthenticated}
          onClosed={handleClosed}
        />
      )}
    </>
  )
}
