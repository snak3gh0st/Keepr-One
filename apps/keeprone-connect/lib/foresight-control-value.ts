type ForesightInput = {
  value: string
  control?: { set_Value?: (value: string) => void }
  dispatchEvent(event: Event): boolean
}

type ForesightSelect = {
  value: string
  options: ArrayLike<{ value: string; selected: boolean }>
}

type ForesightDeferred = {
  done(callback: () => void): ForesightDeferred
  fail(callback: () => void): ForesightDeferred
}

/// Foresight's ASP.NET widgets keep a value separate from the visible input.
/// Writing only `input.value` looks right momentarily, but its next update can
/// restore the old carrier value. Prefer the widget setter, then send the
/// browser events the carrier schedules expect.
export function writeForesightControlValue(input: ForesightInput, value: number): void {
  const normalized = String(value)
  if (input.control?.set_Value) input.control.set_Value(normalized)
  else input.value = normalized
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('blur', { bubbles: true }))
}

export function selectForesightOption(select: ForesightSelect, value: string): boolean {
  const options = Array.from(select.options)
  if (!options.some((option) => option.value === value)) return false
  for (const option of options) option.selected = option.value === value
  select.value = value
  return true
}

export async function applyForesightAllocationPreference(input: {
  select: ForesightSelect
  preference: string
  sessionTokenId(): string
  sendRequest(path: string, parameters: unknown[]): ForesightDeferred
  postBack(target: string, argument: string): void
}): Promise<boolean> {
  if (!selectForesightOption(input.select, input.preference)) return false
  await new Promise<void>((resolve, reject) => {
    input.sendRequest('PageService.asmx/UpdatePremiumAllocationPreference', [
      input.sessionTokenId(),
      input.preference,
    ]).done(resolve).fail(reject)
  })
  input.postBack('ctl00_mobilityPH_panelInterestRates_upAssumedRate', '')
  return true
}
