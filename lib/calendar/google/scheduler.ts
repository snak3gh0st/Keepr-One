import 'server-only'

import * as Sentry from '@sentry/nextjs'
import { getGoogleCalendarEnv, isGoogleCalendarConfigured } from './env'
import { drainGoogleCalendarOutbox } from './outbox'
import { generateDueCalendarNotifications } from './notifications'
import { enqueueGoogleCalendarReconciliation, reconcileGoogleCalendarWatches } from './reconciliation'

type SchedulerState = {
  workerTimer: ReturnType<typeof setInterval> | null
  reconcileTimer: ReturnType<typeof setInterval> | null
  firstRunTimer: ReturnType<typeof setTimeout> | null
  workerRunning: boolean
  reconcileRunning: boolean
}

const STATE_KEY = Symbol.for('keeprOne.googleCalendar.scheduler')
const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: SchedulerState }

function state(): SchedulerState {
  globalState[STATE_KEY] ??= {
    workerTimer: null,
    reconcileTimer: null,
    firstRunTimer: null,
    workerRunning: false,
    reconcileRunning: false,
  }
  return globalState[STATE_KEY]
}

async function workerTick(current: SchedulerState) {
  if (current.workerRunning) return
  current.workerRunning = true
  try {
    await drainGoogleCalendarOutbox(getGoogleCalendarEnv())
    await generateDueCalendarNotifications()
  } catch (error) {
    Sentry.captureException(error)
  } finally {
    current.workerRunning = false
  }
}

async function reconcileTick(current: SchedulerState) {
  if (current.reconcileRunning) return
  current.reconcileRunning = true
  try {
    const env = getGoogleCalendarEnv()
    await enqueueGoogleCalendarReconciliation()
    await reconcileGoogleCalendarWatches(env)
  } catch (error) {
    Sentry.captureException(error)
  } finally {
    current.reconcileRunning = false
  }
}

export function startGoogleCalendarScheduler() {
  if (!isGoogleCalendarConfigured()) return null
  const env = getGoogleCalendarEnv()
  if (env.schedulerDisabled) return null
  const current = state()
  if (current.workerTimer || current.firstRunTimer) return { stop: stopGoogleCalendarScheduler }
  current.firstRunTimer = setTimeout(() => {
    current.firstRunTimer = null
    void workerTick(current)
    void reconcileTick(current)
    current.workerTimer = setInterval(
      () => void workerTick(current),
      env.workerIntervalSeconds * 1000,
    )
    current.reconcileTimer = setInterval(
      () => void reconcileTick(current),
      env.reconcileIntervalSeconds * 1000,
    )
    current.workerTimer.unref?.()
    current.reconcileTimer.unref?.()
  }, 10_000)
  current.firstRunTimer.unref?.()
  return { stop: stopGoogleCalendarScheduler }
}

export function stopGoogleCalendarScheduler() {
  const current = state()
  if (current.firstRunTimer) clearTimeout(current.firstRunTimer)
  if (current.workerTimer) clearInterval(current.workerTimer)
  if (current.reconcileTimer) clearInterval(current.reconcileTimer)
  current.firstRunTimer = null
  current.workerTimer = null
  current.reconcileTimer = null
  current.workerRunning = false
  current.reconcileRunning = false
}
