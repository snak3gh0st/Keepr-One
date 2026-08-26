import { createHash, randomBytes } from 'node:crypto'

export const AGENCY_INVITATION_TOKEN_BYTES = 32
export const AGENCY_INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function hashAgencyInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function createAgencyInvitationToken(): {
  rawToken: string
  tokenHash: string
} {
  const rawToken = randomBytes(AGENCY_INVITATION_TOKEN_BYTES).toString('base64url')
  return {
    rawToken,
    tokenHash: hashAgencyInvitationToken(rawToken),
  }
}

export function isValidAgencyInvitationToken(token: string): boolean {
  return AGENCY_INVITATION_TOKEN_PATTERN.test(token)
}

export function agencyInvitationUrl(token: string): string {
  if (!isValidAgencyInvitationToken(token)) {
    throw new TypeError('Invalid agency invitation token')
  }

  const fallbackOrigin = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : 'https://app.keeprone.com'
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.BETTER_AUTH_URL
    ?? fallbackOrigin
  const origin = new URL(configuredOrigin).origin

  return new URL(`/convites/agencia/${token}`, origin).toString()
}

/**
 * A local subscription can only be activated when both conditions are true.
 * Keeping the production check here means a mistakenly copied environment
 * variable can never turn the demo action into a real billing authority.
 */
export function isLocalBillingSimulationEnabled(): boolean {
  return process.env.NODE_ENV !== 'production'
    && process.env.ALLOW_LOCAL_BILLING_SIMULATION === 'true'
}
