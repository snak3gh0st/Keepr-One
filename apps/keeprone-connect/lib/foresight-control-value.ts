type ForesightInput = {
  value: string
  control?: {
    set_Value?: (value: string) => void
    get_RawValue?: () => string | number
  }
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
export function writeForesightControlValue(input: ForesightInput, value: number): boolean {
  if (!input.control?.set_Value) return false
  const normalized = String(value)
  input.control.set_Value(normalized)
  const carrierValue = input.control.get_RawValue?.() ?? input.value
  const observed = Number(String(carrierValue).replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(observed) || Math.abs(observed - value) > 0.005) return false
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('blur', { bubbles: true }))
  return true
}

export async function writeForesightControlValueWhenReady(input: {
  read(): ForesightInput
  value: number
  wait(): Promise<unknown>
  attempts?: number
}): Promise<boolean> {
  const attempts = input.attempts ?? 25
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (writeForesightControlValue(input.read(), input.value)) return true
    } catch {
      // Foresight replaces the iframe document during ASP.NET postbacks.
    }
    if (attempt + 1 < attempts) await input.wait()
  }
  return false
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
