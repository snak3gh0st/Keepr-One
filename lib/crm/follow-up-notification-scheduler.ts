import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'

const DEFAULT_INTERVAL_SECONDS = 300
const MIN_INTERVAL_SECONDS = 60
const MAX_INTERVAL_SECONDS = 24 * 60 * 60
const FIRST_RUN_DELAY_MS = 15_000
const MIN_SECRET_LENGTH = 32

export type FollowUpNotificationAuthResult = 'OK' | 'NOT_CONFIGURED' | 'DENIED'

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Protects the manual/cron trigger without leaking the configured secret's
 * length. With no strong secret configured the endpoint deliberately behaves
 * as unavailable.
 */
export function authorizeFollowUpNotificationRequest(
  authorization: string | null,
  secret: string | undefined = process.env.CRM_FOLLOW_UP_CRON_SECRET,
): FollowUpNotificationAuthResult {
  const configured = secret?.trim() ?? ''
  if (configured.length < MIN_SECRET_LENGTH) return 'NOT_CONFIGURED'
  if (!authorization?.startsWith('Bearer ')) return 'DENIED'

  const presented = authorization.slice('Bearer '.length).trim()
  if (!presented) return 'DENIED'

  return timingSafeEqual(digest(presented), digest(configured)) ? 'OK' : 'DENIED'
}

export function parseFollowUpNotificationIntervalSeconds(value: string | undefined): number {
  const raw = value?.trim()
  if (!raw) return DEFAULT_INTERVAL_SECONDS

  const parsed = Number(raw)
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_INTERVAL_SECONDS ||
    parsed > MAX_INTERVAL_SECONDS
  ) {
    throw new Error(
      `CRM_FOLLOW_UP_INTERVAL_SECONDS must be an integer between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`,
    )
  }
  return parsed
}

export async function runFollowUpNotificationPass(now = new Date()) {
  // Keep Prisma out of the instrumentation import path until a pass actually
  // runs. This makes boot cheap and keeps a database outage from breaking boot.
  const { generateDueFollowUpNotifications } = await import('./follow-ups')
  return generateDueFollowUpNotifications(now)
}

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null
  running: boolean
}

const STATE_KEY = Symbol.for('keeprOne.crm.followUpNotificationScheduler')
const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: SchedulerState }

function getState(): SchedulerState {
  globalState[STATE_KEY] ??= { timer: null, running: false }
  return globalState[STATE_KEY]
}

async function tick(state: SchedulerState, pass: () => Promise<unknown>): Promise<void> {
  if (state.running) return
  state.running = true
  try {
    await pass()
  } catch (error) {
    Sentry.captureException(error)
  } finally {
    state.running = false
  }
}

export type FollowUpNotificationScheduleHandle = { stop: () => void } | null

/**
 * Starts the server-side catch-up loop. The domain pass scans every scheduled
 * follow-up due up to `now` and deduplicates by follow-up + scheduled timestamp,
 * so a restart catches missed reminders without duplicating notifications.
 */
export function startFollowUpNotificationScheduler(options: {
  intervalSeconds?: number
  firstRunDelayMs?: number
  pass?: () => Promise<unknown>
} = {}): FollowUpNotificationScheduleHandle {
  const state = getState()
  if (state.timer) return { stop: stopFollowUpNotificationScheduler }

  const intervalSeconds =
    options.intervalSeconds ??
    parseFollowUpNotificationIntervalSeconds(process.env.CRM_FOLLOW_UP_INTERVAL_SECONDS)
  const intervalMs = intervalSeconds * 1_000
  const pass = options.pass ?? (() => runFollowUpNotificationPass())

  const start = setTimeout(() => {
    void tick(state, pass)
    const interval = setInterval(() => void tick(state, pass), intervalMs)
    interval.unref?.()
    state.timer = interval
  }, options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS)
  start.unref?.()
  state.timer = start

  return { stop: stopFollowUpNotificationScheduler }
}

export function stopFollowUpNotificationScheduler(): void {
  const state = getState()
  if (!state.timer) return
  clearTimeout(state.timer as ReturnType<typeof setTimeout>)
  clearInterval(state.timer as ReturnType<typeof setInterval>)
  state.timer = null
  state.running = false
}
