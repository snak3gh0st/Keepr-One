'use client'

import { useSyncExternalStore } from 'react'

/// A clock the browser owns and React subscribes to.
///
/// Reading the time after mount is not optional: computing "expires in" during
/// render makes the server HTML and the first client render disagree, and React
/// calls that a hydration mismatch. The obvious way to defer it — `useState`
/// plus `setState` in an effect body — costs a cascading render, and is what
/// `react-hooks/set-state-in-effect` refuses. A clock is an external source by
/// definition, so it enters through the door built for one.
///
/// `getSnapshot` deliberately returns a remembered value. Returning `Date.now()`
/// raw would hand React a different value on every render and loop forever.
export function browserClock(intervalMs: number) {
  let snapshot: number | null = null
  return {
    subscribe(onStoreChange: () => void) {
      snapshot = Date.now()
      const timer = setInterval(() => {
        snapshot = Date.now()
        onStoreChange()
      }, intervalMs)
      return () => clearInterval(timer)
    },
    getSnapshot: () => snapshot,
    /// Before anything subscribes, nothing counts as expired — which is exactly
    /// what the server already assumed when it built the list.
    getServerSnapshot: (): number | null => null,
  }
}

export type BrowserClock = ReturnType<typeof browserClock>

/// `null` until the subscription exists, then the wall clock, ticking.
export function useBrowserClock(clock: BrowserClock): number | null {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getServerSnapshot)
}
