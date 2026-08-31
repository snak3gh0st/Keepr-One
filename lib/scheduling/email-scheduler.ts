import 'server-only'

import * as Sentry from '@sentry/nextjs'
import { isEmailDeliveryConfigured } from '@/lib/email/client'
import { drainSchedulingEmailOutbox } from './email-outbox'

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null
  firstRunTimer: ReturnType<typeof setTimeout> | null
  running: boolean
}

const STATE_KEY = Symbol.for('keeprOne.schedulingEmail.scheduler')
const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: SchedulerState }

function state() {
  globalState[STATE_KEY] ??= { timer: null, firstRunTimer: null, running: false }
  return globalState[STATE_KEY]
}

function intervalMilliseconds(raw = process.env.SCHEDULING_EMAIL_INTERVAL_SECONDS) {
  if (!raw?.trim()) return 30_000
  const seconds = Number(raw)
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3_600) {
    throw new Error('SCHEDULING_EMAIL_INTERVAL_SECONDS must be an integer between 5 and 3600')
  }
  return seconds * 1_000
}

async function workerTick(current: SchedulerState) {
  if (current.running) return
  current.running = true
  try {
    await drainSchedulingEmailOutbox()
  } catch (error) {
    Sentry.captureException(error)
  } finally {
    current.running = false
  }
}

export function startSchedulingEmailScheduler() {
  if (!isEmailDeliveryConfigured()) return null
  const current = state()
  if (current.timer || current.firstRunTimer) return { stop: stopSchedulingEmailScheduler }
  const intervalMs = intervalMilliseconds()
  current.firstRunTimer = setTimeout(() => {
    current.firstRunTimer = null
    void workerTick(current)
    current.timer = setInterval(() => void workerTick(current), intervalMs)
    current.timer.unref?.()
  }, 5_000)
  current.firstRunTimer.unref?.()
  return { stop: stopSchedulingEmailScheduler }
}

export function stopSchedulingEmailScheduler() {
  const current = state()
  if (current.firstRunTimer) clearTimeout(current.firstRunTimer)
  if (current.timer) clearInterval(current.timer)
  current.firstRunTimer = null
  current.timer = null
  current.running = false
}
