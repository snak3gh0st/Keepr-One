import { createHmac, timingSafeEqual } from 'node:crypto'

const MIN_SECRET_LENGTH = 32

/**
 * Opt-out links travel through inboxes, forwards and link scanners, so the
 * token must prove the recipient without being guessable and without carrying
 * a session. It is derived from a server secret and the subscription id, so it
 * is stable (the same link keeps working across the whole sequence) and it can
 * only ever unsubscribe the one account it was minted for.
 */
export function retentionEmailOptOutToken(
  platformSubscriptionId: string,
  secret: string | undefined = process.env.BILLING_EMAIL_TOKEN_SECRET,
): string | null {
  const configured = secret?.trim() ?? ''
  if (configured.length < MIN_SECRET_LENGTH) return null
  return createHmac('sha256', configured)
    .update(`retention-opt-out:${platformSubscriptionId}`)
    .digest('base64url')
}

export function verifyRetentionEmailOptOutToken(
  platformSubscriptionId: string,
  presented: string,
  secret: string | undefined = process.env.BILLING_EMAIL_TOKEN_SECRET,
): boolean {
  const expected = retentionEmailOptOutToken(platformSubscriptionId, secret)
  if (!expected) return false

  const a = Buffer.from(expected)
  const b = Buffer.from(presented)
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
