export type ProgressReporter<T> = {
  report(value: T): void
  flush(): Promise<void>
}

/// Progress is presentation-only, but it still needs ordering. Content scripts
/// can advance through several carrier screens before Chrome resolves the
/// previous runtime message; serializing the sends prevents the UI from moving
/// backwards or receiving a stale phase after the command result.
export function createProgressReporter<T>(
  send: (value: T) => Promise<unknown>,
): ProgressReporter<T> {
  let tail: Promise<void> = Promise.resolve()

  return {
    report(value) {
      tail = tail.then(async () => {
        try {
          await send(value)
        } catch {
          // Progress cannot become an execution dependency. The sealed result
          // and command receipt remain authoritative if presentation fails.
        }
      })
    },
    flush() {
      return tail
    },
  }
}
