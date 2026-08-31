import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('native scheduling additive migration', () => {
  const sql = fs.readFileSync(path.join(
    process.cwd(),
    'prisma/migrations/20260828120000_add_native_scheduling/migration.sql',
  ), 'utf8')

  it('uses PostgreSQL-compatible slug validation and bounded scheduling settings', () => {
    expect(sql).toContain("^[a-z0-9]+(-[a-z0-9]+)*$")
    expect(sql).not.toContain('(?:')
    expect(sql).toContain('CONSTRAINT "SchedulingPage_duration_check"')
    expect(sql).toContain('CONSTRAINT "SchedulingWeeklyWindow_bounds_check"')
  })

  it('prevents concurrent overlapping confirmed reservations with half-open ranges', () => {
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist')
    expect(sql).toContain('CONSTRAINT "SchedulingBooking_owner_active_range_excl"')
    expect(sql).toContain('tstzrange("blockedStartsAt", "blockedEndsAt", \'[)\') WITH &&')
    expect(sql).toContain('WHERE ("status" = \'CONFIRMED\')')
  })

  it('stores only hashed idempotency and management secrets', () => {
    expect(sql).toContain('"idempotencyKeyHash" TEXT NOT NULL')
    expect(sql).toContain('"manageTokenHash" TEXT NOT NULL')
    expect(sql).toContain('CONSTRAINT "SchedulingBooking_hashes_check"')
  })
})

describe('scheduling confirmation email outbox additive migration', () => {
  const sql = fs.readFileSync(path.join(
    process.cwd(),
    'prisma/migrations/20260828150000_add_scheduling_email_outbox/migration.sql',
  ), 'utf8')

  it('adds the durable email job state machine without destructive statements', () => {
    expect(sql).toContain('CREATE TYPE "SchedulingEmailJobStatus" AS ENUM')
    expect(sql).toContain("'PENDING'")
    expect(sql).toContain("'PROCESSING'")
    expect(sql).toContain("'SUCCEEDED'")
    expect(sql).toContain("'DEAD_LETTER'")
    expect(sql).toContain("'CANCELLED'")
    expect(sql).toContain('CREATE TABLE "SchedulingEmailJob"')
    expect(sql).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE)\b/m)
  })

  it('keeps one idempotent confirmation job per booking with cascade cleanup', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "SchedulingEmailJob_bookingId_key"')
    expect(sql).toContain('CREATE UNIQUE INDEX "SchedulingEmailJob_idempotencyKey_key"')
    expect(sql).toContain('CONSTRAINT "SchedulingEmailJob_idempotency_key_check"')
    expect(sql).toContain('FOREIGN KEY ("bookingId") REFERENCES "SchedulingBooking"("id")')
    expect(sql).toContain('ON DELETE CASCADE ON UPDATE CASCADE')
  })

  it('enforces valid leases, immutable payload version and successful delivery evidence', () => {
    expect(sql).toContain('CONSTRAINT "SchedulingEmailJob_payload_version_check"')
    expect(sql).toContain('CHECK ("payloadVersion" = 1)')
    expect(sql).toContain('CONSTRAINT "SchedulingEmailJob_lease_check"')
    expect(sql).toContain("\"status\" = 'PROCESSING' AND \"leaseOwner\" IS NOT NULL AND \"leaseExpiresAt\" IS NOT NULL")
    expect(sql).toContain('CONSTRAINT "SchedulingEmailJob_success_check"')
    expect(sql).toContain("\"status\" = 'SUCCEEDED' AND \"sentAt\" IS NOT NULL AND \"providerMessageId\" IS NOT NULL")
    expect(sql).toContain('CREATE INDEX "SchedulingEmailJob_status_availableAt_idx"')
    expect(sql).toContain('CREATE INDEX "SchedulingEmailJob_leaseExpiresAt_idx"')
  })
})
