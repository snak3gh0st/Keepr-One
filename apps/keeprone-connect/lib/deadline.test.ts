import { afterEach, describe, expect, it, vi } from 'vitest'
import { withDeadline } from './deadline'

afterEach(() => {
  vi.useRealTimers()
})

describe('withDeadline', () => {
  it('devolve o valor quando a promessa responde dentro do prazo', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 1_000, 'TIMED_OUT')).resolves.toBe('ok')
  })

  it('propaga a rejeição original sem esperar o prazo', async () => {
    await expect(withDeadline(Promise.reject(new Error('BRIDGE_UNAVAILABLE')), 1_000, 'TIMED_OUT'))
      .rejects.toThrow('BRIDGE_UNAVAILABLE')
  })

  it('não deixa o perdedor da corrida rejeitar sem tratador', async () => {
    vi.useFakeTimers()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    let rejectLate: ((error: Error) => void) | undefined
    const late = new Promise<string>((_, reject) => { rejectLate = reject })

    const raced = withDeadline(late, 1_000, 'TIMED_OUT')
    const assertion = expect(raced).rejects.toThrow('TIMED_OUT')
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion

    // É o que acontece de verdade: o chamador recarrega a aba e a mensagem órfã
    // morre com "message port closed", depois de a corrida já ter terminado.
    rejectLate?.(new Error('message port closed'))
    await vi.advanceTimersByTimeAsync(0)
    vi.useRealTimers()
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('termina a espera de uma promessa que nunca liquida', async () => {
    vi.useFakeTimers()
    const pending = new Promise<string>(() => {})
    const raced = withDeadline(pending, 5_000, 'PORTAL_PROBE_UNAVAILABLE')
    const assertion = expect(raced).rejects.toThrow('PORTAL_PROBE_UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
  })
})
