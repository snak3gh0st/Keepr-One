import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'

function configuredFounderAccessCodes(): string[] {
  const values = [
    process.env.FOUNDERS_ACCESS_CODES ?? '',
    // Backward-compatible single-code setting, also convenient for local QA.
    process.env.FOUNDERS_ACCESS_CODE ?? '',
  ]

  return [...new Set(
    values
      .flatMap((value) => value.split(/[\n,]/))
      .map((value) => value.trim())
      .filter(Boolean),
  )]
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function isFounderRegistrationOpen(): boolean {
  return configuredFounderAccessCodes().length > 0
}

/**
 * Returns the stable hash persisted with an enrollment when the invite is
 * valid. Each configured code is redeemable once; the database unique index
 * closes concurrent double-redemption attempts.
 */
export function matchFounderAccessCode(candidate: string): string | null {
  const candidateDigest = sha256(candidate)
  let matchedDigest: Buffer | null = null

  // Compare every configured entry so the position of the matching invite is
  // not exposed through an early-return timing difference.
  for (const configuredCode of configuredFounderAccessCodes()) {
    const configuredDigest = sha256(configuredCode)
    if (timingSafeEqual(candidateDigest, configuredDigest)) {
      matchedDigest = configuredDigest
    }
  }

  return matchedDigest?.toString('hex') ?? null
}
