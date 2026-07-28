'use client'

import { useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useRouter } from 'next/navigation'
import { Logo } from '@/components/Logo'
import { authClient } from '@/lib/auth-client'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const securitySignals = [
  {
    title: 'Acesso por perfil',
    description: 'Cada pessoa vê apenas o que precisa para trabalhar.',
  },
  {
    title: 'Histórico preservado',
    description: 'Movimentos importantes permanecem organizados e rastreáveis.',
  },
  {
    title: 'Operação unificada',
    description: 'Carteira, clientes e pendências vivem na mesma perspectiva.',
  },
]

const marqueeItems = [
  'Acesso monitorado',
  'Dados organizados',
  'Sessões protegidas',
  'Decisões com clareza',
]

function EyeIcon({ crossed = false }: { crossed?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M2.7 12s3.3-5 9.3-5 9.3 5 9.3 5-3.3 5-9.3 5-9.3-5-9.3-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.35" stroke="currentColor" strokeWidth="1.5" />
      {crossed && (
        <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
    </svg>
  )
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={`h-4 w-4 ${direction === 'left' ? 'rotate-180' : ''}`}
      fill="none"
    >
      <path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EnterIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M4 10h11M11 6l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const scope = useRef<HTMLElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [signalIndex, setSignalIndex] = useState(0)

  useGSAP(
    () => {
      const media = gsap.matchMedia()

      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-login-reveal]', {
          y: 22,
          opacity: 0,
          duration: 0.9,
          stagger: 0.075,
          ease: 'power3.out',
        })

        gsap.fromTo(
          '[data-visual-shell]',
          { scale: 0.84, opacity: 0.25 },
          { scale: 1, opacity: 1, duration: 1.45, ease: 'power3.out' },
        )

        gsap.to('[data-orbit-rotation]', {
          rotation: 360,
          transformOrigin: '50% 50%',
          duration: 44,
          repeat: -1,
          ease: 'none',
        })

        gsap.to('[data-pulse-node]', {
          scale: 1.55,
          opacity: 0.24,
          transformOrigin: '50% 50%',
          duration: 1.8,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
        })

        const marquee = scope.current?.querySelector<HTMLElement>('[data-login-marquee]')
        if (marquee) {
          gsap.to(marquee, {
            xPercent: -50,
            duration: 24,
            repeat: -1,
            ease: 'none',
          })
        }
      })

      media.add(
        '(max-width: 1023px) and (prefers-reduced-motion: no-preference)',
        () => {
          const words = gsap.utils.toArray<HTMLElement>('[data-login-word]')
          gsap.fromTo(
            words,
            { opacity: 0.35 },
            {
              opacity: 1,
              stagger: 0.05,
              ease: 'none',
              scrollTrigger: {
                trigger: '[data-login-message]',
                start: 'top 90%',
                end: 'bottom 55%',
                scrub: 0.45,
              },
            },
          )
        },
      )

      return () => media.revert()
    },
    { scope },
  )

  useGSAP(
    () => {
      gsap.fromTo(
        '[data-signal-copy]',
        { y: 8, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.45, ease: 'power3.out' },
      )
    },
    { scope, dependencies: [signalIndex] },
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const { error: signInError } = await authClient.signIn.email({ email, password })

      if (signInError) {
        setError('Não foi possível entrar. Confira seu e-mail e sua senha.')
        return
      }

      router.replace('/')
      router.refresh()
    } catch {
      setError('A conexão falhou. Tente novamente em alguns instantes.')
    } finally {
      setSubmitting(false)
    }
  }

  function changeSignal(direction: -1 | 1) {
    setSignalIndex((current) => (current + direction + securitySignals.length) % securitySignals.length)
  }

  const activeSignal = securitySignals[signalIndex]

  return (
    <main ref={scope} className="login-page-surface relative isolate min-h-[100svh] w-full max-w-full overflow-x-hidden text-white">
      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-[1600px] items-center p-3 sm:p-5 lg:p-7 xl:px-10">
        <div className="mx-auto grid min-h-[calc(100svh-1.5rem)] w-full grid-flow-dense grid-cols-1 overflow-hidden rounded-[22px] border border-white/[0.12] bg-[#090909] shadow-[0_42px_140px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.018)] sm:min-h-[calc(100svh-2.5rem)] lg:min-h-[min(1020px,calc(100svh-3.5rem))] lg:max-w-[1420px] lg:grid-cols-12">
          <section className="col-span-full flex min-h-[680px] flex-col bg-[#0a0a0a] p-6 sm:p-9 lg:col-span-5 lg:min-h-0 lg:px-12 lg:pb-12 lg:pt-8 xl:px-16 xl:pb-16 xl:pt-10">
            <header data-login-reveal className="flex items-center justify-between gap-6">
              <Logo size={32} wordmark={false} className="text-[1.05rem] text-white" />
              <div className="flex items-center gap-2 text-[0.68rem] font-medium uppercase tracking-[0.15em] text-white/55">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_14px_rgba(91,216,144,0.75)]" />
                Acesso protegido
              </div>
            </header>

            <div className="my-auto w-full max-w-[430px] self-center py-16 sm:py-20 lg:py-6">
              <div className="mb-10">
                <div data-login-reveal className="mb-7 h-px w-12 bg-mint" />
                <h1 data-login-reveal className="max-w-xl text-[clamp(2.7rem,4.2vw,4.7rem)] font-medium leading-[0.98] tracking-[-0.065em] text-white">
                  Bem-vindo de volta.
                </h1>
                <p data-login-reveal className="mt-5 max-w-sm text-[0.95rem] leading-7 text-white/52">
                  Entre para acessar uma visão clara da sua operação financeira.
                </p>
              </div>

              <form onSubmit={handleSubmit} aria-busy={submitting} className="space-y-5">
                <label data-login-reveal htmlFor="login-email" className="block">
                  <span className="mb-2.5 block text-xs font-medium tracking-[0.08em] text-white/58">
                    E-mail
                  </span>
                  <input
                    id="login-email"
                    type="email"
                    name="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      if (error) setError(null)
                    }}
                    required
                    autoComplete="email"
                    inputMode="email"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'login-error' : undefined}
                    placeholder="voce@email.com"
                    className="login-input h-14 w-full rounded-xl border border-white/[0.18] bg-white/[0.035] px-4 text-base text-white outline-none transition-[border-color,background-color,box-shadow] duration-300 placeholder:text-white/38 hover:border-white/35 focus-visible:border-mint/70 focus-visible:bg-white/[0.055] focus-visible:ring-4 focus-visible:ring-mint/10"
                  />
                </label>

                <label data-login-reveal htmlFor="login-password" className="block">
                  <span className="mb-2.5 block text-xs font-medium tracking-[0.08em] text-white/58">
                    Senha
                  </span>
                  <span className="relative block">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        if (error) setError(null)
                      }}
                      required
                      autoComplete="current-password"
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'login-error' : undefined}
                      placeholder="Digite sua senha"
                      className="login-input h-14 w-full rounded-xl border border-white/[0.18] bg-white/[0.035] px-4 pr-14 text-base text-white outline-none transition-[border-color,background-color,box-shadow] duration-300 placeholder:text-white/38 hover:border-white/35 focus-visible:border-mint/70 focus-visible:bg-white/[0.055] focus-visible:ring-4 focus-visible:ring-mint/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex w-14 items-center justify-center text-white/58 transition-colors duration-200 hover:text-white focus-visible:text-mint"
                    >
                      <EyeIcon crossed={showPassword} />
                    </button>
                  </span>
                </label>

                <div data-login-reveal className="flex min-h-6 items-center justify-between gap-4">
                  <p className="text-xs leading-5 text-white/48">
                    Use o acesso fornecido pela sua operação.
                  </p>
                  <span className="shrink-0 font-mono text-[0.65rem] tracking-[0.14em] text-white/42">
                    TLS 1.3
                  </span>
                </div>

                {error && (
                  <p
                    id="login-error"
                    role="alert"
                    className="border-l-2 border-danger bg-danger/10 px-4 py-3 text-sm leading-6 text-white/78"
                  >
                    {error}
                  </p>
                )}

                <button
                  data-login-reveal
                  type="submit"
                  disabled={submitting}
                  className="group flex h-14 w-full items-center justify-between rounded-xl bg-white px-5 text-sm font-semibold text-black transition-[background-color,transform] duration-300 hover:bg-[#e9e9e6] active:translate-y-px focus-visible:ring-4 focus-visible:ring-mint/30 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span>{submitting ? 'Verificando acesso…' : 'Entrar no Keepr One'}</span>
                  {submitting ? (
                    <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black" />
                  ) : (
                    <span className="transition-transform duration-300 group-hover:translate-x-1">
                      <EnterIcon />
                    </span>
                  )}
                </button>
              </form>

              <p data-login-reveal className="mt-6 text-center text-xs leading-5 text-white/48">
                Esqueceu sua senha? Fale com seu agente ou administrador.
              </p>
            </div>

            <footer data-login-reveal className="flex items-center justify-between gap-5 text-[0.68rem] text-white/42">
              <span>© {new Date().getFullYear()} Keepr One</span>
              <span>Privacidade por padrão</span>
            </footer>
          </section>

          <section
            aria-labelledby="login-visual-title"
            className="login-tech-field relative col-span-full min-h-[580px] overflow-hidden border-t border-white/[0.12] lg:col-span-7 lg:min-h-0 lg:border-l lg:border-t-0"
          >
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_70%_14%,rgba(255,255,255,0.12),transparent_25%),radial-gradient(circle_at_50%_68%,rgba(70,188,120,0.08),transparent_31%)]" />
            <div aria-hidden className="absolute -right-24 top-8 select-none text-[clamp(10rem,22vw,24rem)] font-semibold leading-none tracking-[-0.1em] text-white/[0.018]">
              K1
            </div>

            <div className="relative z-10 flex h-full min-h-[580px] flex-col justify-between px-6 py-8 sm:px-10 sm:py-10 lg:min-h-full lg:px-14 lg:py-8 xl:px-20 xl:py-10">
              <header data-login-reveal className="flex items-center justify-between gap-5 text-[0.68rem] uppercase tracking-[0.16em] text-white/48 lg:min-h-8">
                <span>Perspectiva financeira</span>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="h-1 w-1 rounded-full bg-mint" />
                  Sistema online
                </span>
              </header>

              <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center py-12 text-center lg:py-4">
                <h2
                  id="login-visual-title"
                  data-login-message
                  className="mx-auto w-full max-w-3xl text-center text-[clamp(2.65rem,5.3vw,5.8rem)] font-medium leading-[0.96] tracking-[-0.068em] text-white"
                >
                  {'Sua operação. Sob controle.'.split(' ').map((word) => (
                    <span key={word} data-login-word className="mr-[0.22em] inline-block last:mr-0">
                      {word}
                      {' '}
                    </span>
                  ))}
                </h2>
                <p data-login-reveal className="mx-auto mt-6 max-w-2xl text-center text-sm leading-7 text-white/55 sm:text-base">
                  Uma visão única para o agente financeiro conduzir clientes, pendências e resultados — do primeiro contato à gestão da carteira.
                </p>

                <div
                  data-visual-shell
                  className="relative mt-10 h-[270px] w-full max-w-[620px] sm:h-[320px] lg:mt-7 lg:h-[280px]"
                >
                  <svg aria-hidden focusable="false" viewBox="0 0 620 320" className="absolute inset-0 h-full w-full overflow-visible" fill="none">
                    <g data-orbit-rotation>
                      <ellipse cx="310" cy="160" rx="244" ry="108" stroke="white" strokeOpacity=".16" />
                      <ellipse cx="310" cy="160" rx="174" ry="154" stroke="white" strokeOpacity=".09" transform="rotate(-28 310 160)" />
                      <ellipse cx="310" cy="160" rx="174" ry="154" stroke="white" strokeOpacity=".09" transform="rotate(28 310 160)" />
                      <path d="M75 194C151 191 180 206 247 157c71-52 107-51 154-29 47 22 73 8 144-37" stroke="white" strokeOpacity=".72" strokeWidth="1.5" />
                      <path d="M395 131c49 22 79 6 147-36" stroke="var(--color-mint)" strokeWidth="2" strokeLinecap="round" />
                      <circle cx="542" cy="95" r="4" fill="var(--color-mint)" />
                      <circle data-pulse-node cx="542" cy="95" r="11" fill="var(--color-mint)" opacity=".1" />
                    </g>
                    <path d="M310 22v276M67 160h486" stroke="white" strokeOpacity=".055" strokeDasharray="3 8" />
                  </svg>

                  <div className="absolute left-1/2 top-1/2 w-[min(88%,390px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[0.18] bg-black/55 p-5 text-left shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-6">
                    <div className="mb-7 flex items-center justify-between gap-4">
                      <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-white/48">
                        Controle operacional
                      </span>
                      <span className="flex items-center gap-2 text-[0.68rem] text-white/56">
                        <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                        Ativo
                      </span>
                    </div>

                    <div data-signal-copy aria-live="polite" className="min-h-[92px]">
                      <p className="text-xl font-medium tracking-[-0.035em] text-white sm:text-2xl">
                        {activeSignal.title}
                      </p>
                      <p className="mt-2 max-w-sm text-xs leading-5 text-white/56 sm:text-sm sm:leading-6">
                        {activeSignal.description}
                      </p>
                    </div>

                    <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                      <span className="font-mono text-[0.62rem] tracking-[0.14em] text-white/44">
                        {String(signalIndex + 1).padStart(2, '0')} / {String(securitySignals.length).padStart(2, '0')}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => changeSignal(-1)}
                          aria-label="Sinal anterior"
                          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-white/60 transition-[border-color,color,transform] duration-300 hover:scale-105 hover:border-white/35 hover:text-white focus-visible:text-mint"
                        >
                          <ArrowIcon direction="left" />
                        </button>
                        <button
                          type="button"
                          onClick={() => changeSignal(1)}
                          aria-label="Próximo sinal"
                          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-white/60 transition-[border-color,color,transform] duration-300 hover:scale-105 hover:border-white/35 hover:text-white focus-visible:text-mint"
                        >
                          <ArrowIcon direction="right" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div data-login-reveal className="login-marquee-mask overflow-hidden border-t border-white/10 pt-5">
                <div data-login-marquee className="login-marquee-track flex">
                  {[...marqueeItems, ...marqueeItems].map((item, index) => (
                    <span
                      key={`${item}-${index}`}
                      className="flex shrink-0 items-center gap-5 pr-5 text-[0.65rem] uppercase tracking-[0.16em] text-white/46"
                    >
                      {item}
                      <span aria-hidden className="h-1 w-1 rounded-full bg-mint/75" />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
