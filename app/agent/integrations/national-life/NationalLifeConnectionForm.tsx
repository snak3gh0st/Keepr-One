"use client";

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { Field, Input } from '@/components/Field'
import {
  deleteNationalLifeConnection,
  saveNationalLifeConnection,
  testNationalLifeConnection,
} from './actions'

type ConnectionSummary = {
  provider: string
  maskedUsername: string
  status: string
  lastTestedAt: Date | string | null
  lastSucceededAt: Date | string | null
  updatedAt: Date | string
}

type BusyAction = 'save' | 'test' | 'delete' | null

function formatDateTime(value: Date | string | null) {
  if (!value) {
    return '—'
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function getStatusPresentation(status: string) {
  switch (status) {
    case 'SUCCEEDED':
      return {
        label: 'Conectada',
        tone: 'bg-success/12 text-success',
        description: 'Último teste concluído com sucesso.',
      }
    case 'CREDENTIALS_EXPIRED':
      return {
        label: 'Credenciais expiradas',
        tone: 'bg-danger/10 text-danger',
        description: 'As credenciais precisam ser atualizadas antes do próximo acesso.',
      }
    case 'WAITING_FOR_MFA':
    case 'WAITING_FOR_REVIEW':
    case 'RETRYABLE':
    case 'FAILED':
    case 'MANUAL_REVIEW':
    case 'ACTION_REQUIRED':
      return {
        label: 'Ação necessária',
        tone: 'bg-amber-100 text-amber-800',
        description: 'Há uma pendência para concluir a conexão com segurança.',
      }
    default:
      return {
        label: 'Não testada',
        tone: 'bg-panel text-ink-muted',
        description: 'As credenciais foram salvas, mas ainda não houve validação do portal.',
      }
  }
}

export function NationalLifeConnectionForm({
  summary,
}: {
  summary: ConnectionSummary | null
}) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const status = useMemo(
    () => getStatusPresentation(summary?.status ?? 'UNTESTED'),
    [summary?.status],
  )

  async function handleSave(formData: FormData) {
    setBusyAction('save')
    setMessage(null)

    try {
      const result = await saveNationalLifeConnection(formData)
      setMessage({ kind: result.ok ? 'success' : 'error', text: result.message })

      if (result.ok) {
        setUsername('')
        router.refresh()
      }
    } finally {
      setPassword('')
      setBusyAction(null)
    }
  }

  async function handleTest() {
    setBusyAction('test')
    setMessage(null)

    try {
      const result = await testNationalLifeConnection()
      setMessage({ kind: result.ok ? 'success' : 'error', text: result.message })

      if (result.ok) {
        router.refresh()
      }
    } finally {
      setPassword('')
      setBusyAction(null)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Desconectar e apagar a credencial salva da National Life?')) {
      return
    }

    setBusyAction('delete')
    setMessage(null)

    try {
      const result = await deleteNationalLifeConnection()
      setMessage({ kind: result.ok ? 'success' : 'error', text: result.message })

      if (result.ok) {
        setUsername('')
        router.refresh()
      }
    } finally {
      setPassword('')
      setBusyAction(null)
    }
  }

  return (
    <div className="rounded-lg border border-border-steel bg-paper p-5">
      <div className="flex flex-col gap-4 border-b border-border-steel pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Conexão National Life</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Salve a credencial do agente, valide a conexão e acompanhe apenas o estado seguro da integração.
            </p>
          </div>
          <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${status.tone}`}>
            {status.label}
          </span>
        </div>

        <div className="grid gap-3 text-sm text-ink-muted sm:grid-cols-3">
          <div className="rounded-md bg-panel px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Identidade salva</p>
            <p className="mt-2 font-medium text-ink">{summary?.maskedUsername ?? 'Nenhuma conexão salva'}</p>
          </div>
          <div className="rounded-md bg-panel px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Último teste</p>
            <p className="mt-2 font-medium text-ink">{formatDateTime(summary?.lastTestedAt ?? null)}</p>
          </div>
          <div className="rounded-md bg-panel px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Último sucesso</p>
            <p className="mt-2 font-medium text-ink">{formatDateTime(summary?.lastSucceededAt ?? null)}</p>
          </div>
        </div>

        <p className="text-sm text-ink-muted">{status.description}</p>
      </div>

      <form action={handleSave} className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Usuário National Life">
          <Input
            name="username"
            type="text"
            autoComplete="off"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Seu usuário do portal"
          />
        </Field>

        <Field label="Senha National Life">
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Senha do portal"
          />
        </Field>

        <div className="md:col-span-2 flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap">
          <Button type="submit" variant="primary" disabled={busyAction !== null}>
            {busyAction === 'save' ? 'Salvando conexão...' : 'Salvar conexão'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busyAction !== null}
            onClick={handleTest}
          >
            {busyAction === 'test' ? 'Enfileirando teste...' : 'Testar conexão'}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={busyAction !== null || !summary}
            onClick={handleDelete}
          >
            {busyAction === 'delete' ? 'Desconectando...' : 'Desconectar'}
          </Button>
        </div>

        {message && (
          <p
            role="status"
            className={`md:col-span-2 text-sm ${message.kind === 'success' ? 'text-success' : 'text-danger'}`}
          >
            {message.text}
          </p>
        )}
      </form>
    </div>
  )
}
