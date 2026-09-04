import 'server-only'
import { featureEnabled } from './domain'
import { maintainFollowups, processNextFollowup } from './worker'
const key = Symbol.for('keeprOne.kbotFollowup.scheduler')
const globalState = globalThis as typeof globalThis & { [key]?: { timer: ReturnType<typeof setInterval>; running: boolean } }
export function startKBotFollowupScheduler() {
  if (!featureEnabled() || globalState[key]) return
  const state = { timer: null as unknown as ReturnType<typeof setInterval>, running: false }
  state.timer = setInterval(async () => {
    if (state.running) return
    state.running = true
    try { await maintainFollowups(); await processNextFollowup() }
    catch { console.error('[kbot-followup] background pass failed') }
    finally { state.running = false }
  }, 10_000)
  state.timer.unref?.()
  globalState[key] = state
}
