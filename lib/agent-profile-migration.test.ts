import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260826103000_add_agent_profile_settings/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('canonical agent profile migration', () => {
  it('backfills the agent phone from the immutable Founder snapshot and constrains future writes', () => {
    expect(migration).toContain('ADD COLUMN "phone" TEXT')
    expect(migration).toContain('FROM "FounderEnrollment" AS enrollment')
    expect(migration).toContain('"Agent_phone_normalized_shape"')
    expect(migration).toContain("'^\\+?[0-9]{7,15}$'")
  })

  it('checks case-insensitive collisions before normalizing user emails', () => {
    const collisionGuard = migration.indexOf(
      'Case-insensitive duplicate user emails require manual resolution',
    )
    const normalization = migration.indexOf(
      '"email" = lower(btrim("email"))',
    )

    expect(collisionGuard).toBeGreaterThan(-1)
    expect(normalization).toBeGreaterThan(collisionGuard)
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "user_email_case_insensitive_key"',
    )
  })

  it('adds canonical shape checks for editable identity labels and time zone', () => {
    expect(migration).toMatch(/"user_name_profile_shape"[\s\S]*?NOT VALID/)
    expect(migration).toMatch(/"user_timeZone_profile_shape"[\s\S]*?NOT VALID/)
    expect(migration).toMatch(/"Agency_name_profile_shape"[\s\S]*?NOT VALID/)
    expect(migration).toContain('"user_email_normalized"')
  })
})
