import { describe, expect, it, vi } from 'vitest'
import { writeForesightControlValue } from './foresight-control-value'

describe('Foresight currency control writer', () => {
  it('uses the carrier control setter before scheduling its change events', () => {
    const dispatchEvent = vi.fn()
    const input: {
      value: string
      control?: { set_Value(value: string): void }
      dispatchEvent: typeof dispatchEvent
    } = {
      value: '1500',
      dispatchEvent,
    }
    const setValue = vi.fn((value: string) => { input.value = value })
    input.control = { set_Value: setValue }

    writeForesightControlValue(input, 50)

    expect(setValue).toHaveBeenCalledWith('50')
    expect(input.value).toBe('50')
    expect(dispatchEvent.mock.calls.map(([event]) => (event as Event).type)).toEqual([
      'input', 'change', 'blur',
    ])
  })

  it('falls back to the visible field only when the carrier widget is absent', () => {
    const dispatchEvent = vi.fn()
    const input = { value: '1500', dispatchEvent }

    writeForesightControlValue(input, 50)

    expect(input.value).toBe('50')
    expect(dispatchEvent).toHaveBeenCalledTimes(3)
  })
})
