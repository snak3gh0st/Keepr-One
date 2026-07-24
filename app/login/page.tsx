'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/Button'
import { Field, Input } from '@/components/Field'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: signInError } = await authClient.signIn.email({ email, password })

    setSubmitting(false)

    if (signInError) {
      setError(signInError.message ?? 'Falha ao entrar. Confira email e senha.')
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <main className="grid min-h-screen w-full bg-panel md:grid-cols-[minmax(0,1.1fr)_minmax(390px,0.8fr)]">
      <div className="relative hidden overflow-hidden bg-rail p-12 text-paper md:flex md:flex-col md:justify-between lg:p-20">
        <Logo size={34} className="relative z-10 text-xl" />
        <div className="relative z-10 max-w-md">
          <p className="text-sm font-semibold text-paper/65">Operações RICOS</p>
          <h1 className="mt-5 max-w-lg text-5xl font-semibold leading-[1.05] tracking-[-0.04em]">A operação começa com números confiáveis.</h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-paper/75">Acompanhe o negócio da sua equipe com os números certos, no momento certo.</p>
        </div>
        <p className="relative z-10 text-xs text-paper/60">Fyntra · Finance, Intelligence and Traction</p>
        <div className="absolute -bottom-40 -right-20 h-[30rem] w-[30rem] rounded-full border-[52px] border-teal/60" />
        <div className="absolute -right-16 top-20 h-72 w-72 rounded-full border border-paper/10" />
      </div>
      <div className="flex items-center justify-center bg-paper px-5 py-12 sm:px-10">
      <div className="w-full max-w-sm">
      <div className="mb-8 md:hidden">
        <Logo size={30} variant="onTeal" className="text-xl text-ink" />
      </div>
      <div className="mb-8">
        <p className="text-xs font-semibold text-teal">Área segura</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Entrar na sua conta</h1>
        <p className="mt-2 text-sm text-ink-muted">Use seu acesso da RICOS para continuar.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <Input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="voce@email.com"
          />
        </Field>
        <Field label="Senha">
          <Input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-danger-pale px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-ink-muted">
        Esqueceu sua senha? Fale com seu agente ou administrador para redefini-la.
      </p>
      </div>
      </div>
    </main>
  )
}
