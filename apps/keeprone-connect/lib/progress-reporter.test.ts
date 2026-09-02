import { describe, expect, it, vi } from 'vitest'
import { createProgressReporter } from './progress-reporter'

describe('createProgressReporter', () => {
  it('delivers phases in order even when Chrome resolves slowly', async () => {
    let releaseFirst: (() => void) | undefined
    const delivered: string[] = []
    const send = vi.fn(async (phase: string) => {
      delivered.push(phase)
      if (phase === 'FIRST') {
        await new Promise<void>((resolve) => { releaseFirst = resolve })
      }
    })
    const reporter = createProgressReporter(send)

    reporter.report('FIRST')
    reporter.report('SECOND')
    await Promise.resolve()

    expect(delivered).toEqual(['FIRST'])
    releaseFirst?.()
    await reporter.flush()
    expect(delivered).toEqual(['FIRST', 'SECOND'])
  })

  it('keeps later progress alive when one presentation message fails', async () => {
    const delivered: string[] = []
    const reporter = createProgressReporter(async (phase: string) => {
      delivered.push(phase)
      if (phase === 'FIRST') throw new Error('popup unavailable')
    })

    reporter.report('FIRST')
    reporter.report('SECOND')
    await reporter.flush()

    expect(delivered).toEqual(['FIRST', 'SECOND'])
  })
})
