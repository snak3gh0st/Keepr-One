const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|session|ssn|social|health|username|email/i

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 8
const MAX_STRING_LENGTH = 2_000
const MAX_DEPTH_VALUE = '[MAX_DEPTH]'

function truncateString(value: string) {
  return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value
}

function redactInternal(value: unknown, depth: number): unknown {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol' ||
    typeof value === 'undefined'
  ) {
    return value
  }

  if (typeof value === 'string') {
    return truncateString(value)
  }

  if (typeof value === 'function') {
    return '[FUNCTION]'
  }

  if (depth >= MAX_DEPTH) {
    return MAX_DEPTH_VALUE
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactInternal(entry, depth + 1))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactInternal(nestedValue, depth + 1),
    ]),
  )
}

export function redactDiagnostic(value: unknown): unknown {
  return redactInternal(value, 0)
}
