export type SameOriginActionInput = {
  origin: string | null
  host: string | null
  forwardedHost: string | null
  forwardedProto: string | null
  nodeEnv?: string
}

export function assertSameOriginAction(input: SameOriginActionInput): void {
  const production = (input.nodeEnv ?? process.env.NODE_ENV) === 'production'
  if (!input.origin) {
    if (production) {
      throw new Error('Invalid action origin')
    }
    return
  }

  const host = parseSingleHeader(input.forwardedHost ?? input.host)
  const protocol = parseSingleHeader(input.forwardedProto)
  if (!host) {
    throw new Error('Invalid action origin')
  }

  let origin: URL
  try {
    origin = new URL(input.origin)
  } catch {
    throw new Error('Invalid action origin')
  }

  const effectiveProtocol = protocol ?? origin.protocol.replace(':', '')
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    (production && (origin.protocol !== 'https:' || effectiveProtocol !== 'https'))
  ) {
    throw new Error('Invalid action origin')
  }

  let expectedOrigin: string
  try {
    expectedOrigin = new URL(`${effectiveProtocol}://${host}`).origin
  } catch {
    throw new Error('Invalid action origin')
  }
  if (origin.origin !== expectedOrigin) {
    throw new Error('Invalid action origin')
  }
}

function parseSingleHeader(value: string | null) {
  const normalized = value?.trim()
  if (!normalized || normalized.includes(',')) {
    return null
  }
  return normalized
}
