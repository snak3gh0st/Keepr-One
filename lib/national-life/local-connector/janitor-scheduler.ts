import 'server-only'
import * as Sentry from '@sentry/nextjs'
import type { LocalConnectorSweepReport } from './janitor'

/// Quem faz a varredura acontecer.
///
/// Não há cron neste projeto e o deploy é um container só no Coolify. Escrever a
/// varredura e deixar o disparo para depois é o caminho conhecido para código
/// morto — é literalmente o que aconteceu com `expiresAt`, escrito e indexado
/// desde o começo e nunca lido. Então o disparo vem junto: um intervalo dentro do
/// próprio processo, ligado no boot do servidor pelo hook de instrumentação.
///
/// Instância única é a premissa. Se um dia houver mais de um container, duas
/// passadas simultâneas não corrompem nada — a varredura é `deleteMany` por id,
/// idempotente — só desperdiçam trabalho.

const DEFAULT_INTERVAL_SECONDS = 900
const MIN_INTERVAL_SECONDS = 60
const MAX_INTERVAL_SECONDS = 24 * 60 * 60

/// Atraso antes da primeira passada. O boot já está ocupado com `migrate deploy`
/// e com o healthcheck do deploy rolante; a varredura pode esperar.
const FIRST_RUN_DELAY_MS = 60_000

export function parseJanitorIntervalSeconds(value: string | undefined): number {
  const raw = value?.trim()
  if (!raw) return DEFAULT_INTERVAL_SECONDS

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < MIN_INTERVAL_SECONDS || parsed > MAX_INTERVAL_SECONDS) {
    throw new Error(
      `NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS must be an integer between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`,
    )
  }
  return parsed
}

export function isJanitorDisabled(value: string | undefined): boolean {
  return value?.trim() === 'true'
}

/// Passada única, com o resultado devolvido. É o que a rota manual chama também,
/// para que disparo automático e disparo humano exercitem exatamente o mesmo
/// caminho.
export async function runLocalConnectorJanitorPass(): Promise<LocalConnectorSweepReport> {
  // Importados aqui, e não no topo, para que carregar este módulo no boot não
  // instancie o Prisma antes da primeira requisição.
  const { prisma } = await import('@/lib/prisma')
  const { sweepLocalConnectorTables } = await import('./janitor')
  return sweepLocalConnectorTables(prisma)
}

type JanitorState = {
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null
  running: boolean
}

// Guardado no globalThis porque o hot reload do dev reavalia o módulo e um
// `let` de módulo perderia o timer anterior, acumulando um intervalo por reload.
const STATE_KEY = Symbol.for('fyntra.nationalLife.localConnectorJanitor')
const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: JanitorState }

function getState(): JanitorState {
  globalState[STATE_KEY] ??= { timer: null, running: false }
  return globalState[STATE_KEY]
}

async function tick(state: JanitorState, pass: () => Promise<unknown>): Promise<void> {
  // Uma passada que passe do intervalo não deve ganhar uma segunda por cima:
  // duas varreduras concorrentes só disputam o mesmo banco.
  if (state.running) return
  state.running = true
  try {
    await pass()
  } catch (error) {
    // Uma varredura que falha não pode derrubar o servidor, e silêncio aqui é
    // como uma tabela volta a crescer sem ninguém notar.
    Sentry.captureException(error)
  } finally {
    state.running = false
  }
}

export type JanitorScheduleHandle = { stop: () => void } | null

/// Liga o intervalo. Devolve `null` quando não há nada a ligar — desligado por
/// flag, ou runtime que não é Node.
export function startLocalConnectorJanitor(options: {
  intervalSeconds?: number
  disabled?: boolean
  firstRunDelayMs?: number
  /// Injetável só para teste; em produção é sempre a passada real.
  pass?: () => Promise<unknown>
} = {}): JanitorScheduleHandle {
  const disabled = options.disabled ?? isJanitorDisabled(process.env.NATIONAL_LIFE_JANITOR_DISABLED)
  if (disabled) return null

  const state = getState()
  if (state.timer) return { stop: () => stopLocalConnectorJanitor() }

  const intervalSeconds =
    options.intervalSeconds ??
    parseJanitorIntervalSeconds(process.env.NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS)
  const intervalMs = intervalSeconds * 1_000
  const pass = options.pass ?? runLocalConnectorJanitorPass

  const start = setTimeout(() => {
    void tick(state, pass)
    const interval = setInterval(() => void tick(state, pass), intervalMs)
    interval.unref?.()
    state.timer = interval
  }, options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS)
  // Sem `unref` o timer segura o processo vivo e um shutdown limpo espera o
  // intervalo inteiro antes de terminar.
  start.unref?.()
  state.timer = start

  return { stop: () => stopLocalConnectorJanitor() }
}

export function stopLocalConnectorJanitor(): void {
  const state = getState()
  if (!state.timer) return
  clearTimeout(state.timer as ReturnType<typeof setTimeout>)
  clearInterval(state.timer as ReturnType<typeof setInterval>)
  state.timer = null
}
