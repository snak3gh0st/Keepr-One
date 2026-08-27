type ForesightInput = {
  value: string
  control?: { set_Value?: (value: string) => void }
  dispatchEvent(event: Event): boolean
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
