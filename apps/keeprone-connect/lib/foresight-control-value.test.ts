import { describe, expect, it, vi } from 'vitest'
import {
  applyForesightAllocationPreference,
  selectForesightOption,
  writeForesightControlValue,
} from './foresight-control-value'

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

describe('Foresight select writer', () => {
  it('selects exactly the requested carrier option', () => {
    const select = {
      value: '22',
      options: [
        { value: '22', selected: true },
        { value: '24', selected: false },
      ],
    }

    expect(selectForesightOption(select, '24')).toBe(true)
    expect(select.value).toBe('24')
    expect(select.options.map((option) => option.selected)).toEqual([false, true])
  })

  it('uses the carrier service and refreshes its allocation panel', async () => {
    const sendRequest = vi.fn(() => {
      const deferred = {
        done(callback: () => void) { callback(); return deferred },
        fail() { return deferred },
      }
      return deferred
    })
    const postBack = vi.fn()
    const select = {
      value: '22',
      options: [{ value: '22', selected: true }, { value: '24', selected: false }],
    }

    await expect(applyForesightAllocationPreference({
      select,
      preference: '24',
      sessionTokenId: () => 'session-123',
      sendRequest,
      postBack,
    })).resolves.toBe(true)
    expect(sendRequest).toHaveBeenCalledWith(
      'PageService.asmx/UpdatePremiumAllocationPreference',
      ['session-123', '24'],
    )
    expect(postBack).toHaveBeenCalledWith('ctl00_mobilityPH_panelInterestRates_upAssumedRate', '')
  })
})
