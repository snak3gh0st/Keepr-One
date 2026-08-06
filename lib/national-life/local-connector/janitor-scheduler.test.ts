import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isJanitorDisabled,
  parseJanitorIntervalSeconds,
  startLocalConnectorJanitor,
  stopLocalConnectorJanitor,
} from './janitor-scheduler'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

afterEach(() => {
  stopLocalConnectorJanitor()
  vi.useRealTimers()
})

describe('janitor interval configuration', () => {
  it('defaults to fifteen minutes', () => {
    expect(parseJanitorIntervalSeconds(undefined)).toBe(900)
    expect(parseJanitorIntervalSeconds('')).toBe(900)
  })

  it('accepts an explicit interval inside the allowed range', () => {
    expect(parseJanitorIntervalSeconds('60')).toBe(60)
    expect(parseJanitorIntervalSeconds('86400')).toBe(86400)
  })

  it('refuses an interval that is too tight, too long or not an integer', () => {
    expect(() => parseJanitorIntervalSeconds('59')).toThrow()
    expect(() => parseJanitorIntervalSeconds('86401')).toThrow()
    expect(() => parseJanitorIntervalSeconds('60.5')).toThrow()
    expect(() => parseJanitorIntervalSeconds('sempre')).toThrow()
  })

  it('treats only the literal true as disabled', () => {
    expect(isJanitorDisabled('true')).toBe(true)
    expect(isJanitorDisabled('false')).toBe(false)
    expect(isJanitorDisabled(undefined)).toBe(false)
    expect(isJanitorDisabled('1')).toBe(false)
  })
})

describe('janitor scheduler', () => {
  it('does not start when disabled by flag', () => {
    vi.useFakeTimers()
    const pass = vi.fn(async () => {})

    const handle = startLocalConnectorJanitor({ disabled: true, pass, firstRunDelayMs: 1 })

    expect(handle).toBeNull()
    vi.advanceTimersByTime(60_000)
    expect(pass).not.toHaveBeenCalled()
  })

  it('waits the first-run delay before the first sweep, then repeats on the interval', async () => {
    vi.useFakeTimers()
    const pass = vi.fn(async () => {})

    startLocalConnectorJanitor({
      pass,
      firstRunDelayMs: 1_000,
      intervalSeconds: 60,
    })

    // O boot já está ocupado com migrate deploy e healthcheck: nada de varrer
    // no instante zero.
    expect(pass).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(pass).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(pass).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(pass).toHaveBeenCalledTimes(3)
  })

  it('skips a tick while the previous sweep is still running', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const pass = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    startLocalConnectorJanitor({ pass, firstRunDelayMs: 1, intervalSeconds: 60 })
    await vi.advanceTimersByTimeAsync(1)
    expect(pass).toHaveBeenCalledTimes(1)

    // Passada mais lenta que o intervalo: os disparos que caem em cima dela não
    // podem virar varreduras concorrentes disputando o mesmo banco.
    await vi.advanceTimersByTimeAsync(180_000)
    expect(pass).toHaveBeenCalledTimes(1)

    release?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pass).toHaveBeenCalledTimes(2)

    // A segunda passada também ficou pendente; soltá-la devolve o agendador ao
    // repouso, senão o `running` vaza para os testes seguintes.
    release?.()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('keeps ticking after a sweep throws', async () => {
    vi.useFakeTimers()
    const pass = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('banco caiu'))
      .mockResolvedValue(undefined)

    startLocalConnectorJanitor({ pass, firstRunDelayMs: 1, intervalSeconds: 60 })
    await vi.advanceTimersByTimeAsync(1)
    expect(pass).toHaveBeenCalledTimes(1)

    // Uma falha que travasse o `running` em true mataria a varredura para sempre
    // sem nenhum sinal.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pass).toHaveBeenCalledTimes(2)
  })

  it('reports a failed sweep instead of swallowing it', async () => {
    vi.useFakeTimers()
    const Sentry = await import('@sentry/nextjs')
    const failure = new Error('banco caiu')

    startLocalConnectorJanitor({
      pass: vi.fn().mockRejectedValue(failure),
      firstRunDelayMs: 1,
      intervalSeconds: 60,
    })
    await vi.advanceTimersByTimeAsync(1)

    expect(Sentry.captureException).toHaveBeenCalledWith(failure)
  })

  it('does not stack a second interval when started twice', async () => {
    vi.useFakeTimers()
    const pass = vi.fn(async () => {})

    startLocalConnectorJanitor({ pass, firstRunDelayMs: 1, intervalSeconds: 60 })
    startLocalConnectorJanitor({ pass, firstRunDelayMs: 1, intervalSeconds: 60 })

    await vi.advanceTimersByTimeAsync(1)
    expect(pass).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(pass).toHaveBeenCalledTimes(2)
  })

  it('stops ticking after stop', async () => {
    vi.useFakeTimers()
    const pass = vi.fn(async () => {})

    startLocalConnectorJanitor({ pass, firstRunDelayMs: 1, intervalSeconds: 60 })
    await vi.advanceTimersByTimeAsync(1)
    expect(pass).toHaveBeenCalledTimes(1)

    stopLocalConnectorJanitor()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(pass).toHaveBeenCalledTimes(1)
  })
})
