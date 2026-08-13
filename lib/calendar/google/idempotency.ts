import { createHash, randomUUID } from 'node:crypto'

const BASE32HEX_ALPHABET = '0123456789abcdefghijklmnopqrstuv'

function toBase32Hex(bytes: Uint8Array) {
  let output = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += BASE32HEX_ALPHABET[(buffer >>> bits) & 31]
      buffer &= (1 << bits) - 1
    }
  }
  if (bits) output += BASE32HEX_ALPHABET[(buffer << (5 - bits)) & 31]
  return output
}
/** Stable, non-PII Google event id for safe create retries. */
export function googleEventIdForLocalEvent(localEventId: string) {
  if (!localEventId.trim()) throw new Error('localEventId is required')
  return `k${toBase32Hex(createHash('sha256').update(`keepr-calendar:${localEventId}`).digest())}`
}

/** Unique Meet request id. Reuse the same value for retries of one revision. */
export function googleMeetRequestId(eventId: string, revision: number) {
  return `m${toBase32Hex(
    createHash('sha256').update(`keepr-meet:${eventId}:r${revision}`).digest(),
  )}`
}

export function newGoogleWatchIdentity() {
  return { channelId: randomUUID(), token: randomUUID() + randomUUID() }
}
