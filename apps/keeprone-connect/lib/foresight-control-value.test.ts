import { describe, expect, it, vi } from 'vitest'
import {
  applyForesightAllocationPreference,
  selectForesightOption,
  writeForesightControlValue,
  writeForesightControlValueWhenReady,
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

    expect(writeForesightControlValue(input, 50)).toBe(true)

    expect(setValue).toHaveBeenCalledWith('50')
    expect(input.value).toBe('50')
    expect(dispatchEvent.mock.calls.map(([event]) => (event as Event).type)).toEqual([
      'input', 'change', 'blur',
    ])
  })

  it('refuses a visible-only write while the carrier schedule widget is absent', () => {
    const dispatchEvent = vi.fn()
    const input = { value: '1500', dispatchEvent }

    expect(writeForesightControlValue(input, 50)).toBe(false)

    expect(input.value).toBe('1500')
    expect(dispatchEvent).not.toHaveBeenCalled()
  })

  it('refuses a write when the carrier widget reads back a different amount', () => {
    const dispatchEvent = vi.fn()
    const input = {
      value: '1500',
      control: {
        set_Value: vi.fn(),
        get_RawValue: vi.fn(() => '1500'),
      },
      dispatchEvent,
    }

    expect(writeForesightControlValue(input, 100)).toBe(false)
    expect(dispatchEvent).not.toHaveBeenCalled()
  })

  it('waits for the carrier schedule widget before writing an approved amount', async () => {
    const staleInput = { value: '1500', dispatchEvent: vi.fn() }
    const readyInput: {
      value: string
      control?: { set_Value(value: string): void }
      dispatchEvent: ReturnType<typeof vi.fn>
    } = { value: '1500', dispatchEvent: vi.fn() }
    readyInput.control = { set_Value: (value) => { readyInput.value = value } }
    const read = vi.fn()
      .mockReturnValueOnce(staleInput)
      .mockReturnValueOnce(readyInput)
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(writeForesightControlValueWhenReady({ read, value: 100, wait }))
      .resolves.toBe(true)

    expect(staleInput.value).toBe('1500')
    expect(readyInput.value).toBe('100')
    expect(read).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting while the carrier replaces its iframe document', async () => {
    const readyInput: {
      value: string
      control?: { set_Value(value: string): void }
      dispatchEvent: ReturnType<typeof vi.fn>
    } = { value: '1500', dispatchEvent: vi.fn() }
    readyInput.control = { set_Value: (value) => { readyInput.value = value } }
    const read = vi.fn()
      .mockImplementationOnce(() => { throw new Error('document replaced') })
      .mockReturnValueOnce(readyInput)
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(writeForesightControlValueWhenReady({ read, value: 100, wait }))
      .resolves.toBe(true)
    expect(readyInput.value).toBe('100')
    expect(wait).toHaveBeenCalledTimes(1)
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
