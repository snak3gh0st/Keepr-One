export const FORESIGHT_READ_SERVICES = [
  'WidgetService.asmx/GetQuickCalcData',
  'WidgetService.asmx/GetQuickCalcStatus',
  'WidgetService.asmx/GetInsuredInformation',
  'WidgetService.asmx/GetState',
  'PageService.asmx/GetPolicyInformation',
] as const satisfies readonly string[]

export type ForesightCaseListing = {
  externalKey: string
  displayName: string
  caseKind: string | null
  product: string | null
}

export type ForesightServiceObservation = {
  serviceName: string
  payloadShape: unknown
  payload: unknown
  validationState: 'VALID' | 'INVALID'
}

const SENSITIVE_KEY_PARTS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'session',
  'ssn',
  'social',
  'health',
  'username',
  'email',
  'phone',
  'dob',
  'dateofbirth',
  'address',
]

const SUMMARY_KEYS = {
  caseKind: ['caseKind', 'CaseKind', 'caseType', 'CaseType', 'caseTypeName', 'CaseTypeName'],
  product: ['product', 'Product', 'productName', 'ProductName', 'productType', 'ProductType'],
} as const

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
}

function safeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Parse only Foresight's Recent-panel case anchors. */
export function parseForesightCaseListings(documentHtml: string): ForesightCaseListing[] {
  const listings: ForesightCaseListing[] = []
  const anchorPattern = /<a\b[^>]*\bid\s*=\s*["'][^"']*lnkCaseName[^"']*["'][^>]*>([\s\S]*?)<\/a\s*>/gi

  for (const match of documentHtml.matchAll(anchorPattern)) {
    const displayName = (match[1] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    if (!displayName) continue

    listings.push({
      // Foresight exposes the visible case label as the only stable value in
      // this panel. It is a carrier key for lookup, not a commercial identity.
      externalKey: displayName,
      displayName,
      caseKind: /-QQ-/i.test(displayName) ? 'QUICK_QUOTE' : 'CASE',
      product: null,
    })
  }

  return listings
}

/** Describe content without returning payload values. */
export function describeForesightShape(value: unknown, depth = 0): unknown {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return depth >= 3
      ? `array(${value.length})`
      : { array: value.length, of: value.length ? describeForesightShape(value[0], depth + 1) : 'empty' }
  }

  switch (typeof value) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'string':
      return `string(${value.length})`
    case 'object': {
      if (depth >= 3) return 'object'
      const shape: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        shape[key] = describeForesightShape(nested, depth + 1)
      }
      return shape
    }
    default:
      return typeof value
  }
}

/** Redact Foresight payloads before persistence or diagnostics. */
export function redactForesightPayload(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.slice(0, 2_000)
  if (value === null || typeof value !== 'object') return value
  if (depth >= 8) return '[DEPTH_LIMIT]'

  if (Array.isArray(value)) {
    return value.map((entry) => redactForesightPayload(entry, depth + 1))
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = isSensitiveKey(key)
      ? '[REDACTED]'
      : redactForesightPayload(nested, depth + 1)
  }
  return redacted
}

function explicitSummaryValue(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const result = safeText(value[key])
    if (result) return result
  }
  return null
}

/** Extract only direct, named carrier summary fields. */
export function summarizeForesightCase(
  value: unknown,
): Pick<ForesightCaseListing, 'caseKind' | 'product'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { caseKind: null, product: null }
  }

  const record = value as Record<string, unknown>
  return {
    caseKind: explicitSummaryValue(record, SUMMARY_KEYS.caseKind),
    product: explicitSummaryValue(record, SUMMARY_KEYS.product),
  }
}

export function isForesightReadService(value: string): boolean {
  return (FORESIGHT_READ_SERVICES as readonly string[]).includes(value)
}
