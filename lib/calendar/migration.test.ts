import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('calendar additive migration', () => {
  const sql = fs.readFileSync(path.join(
    process.cwd(), 'prisma/migrations/20260812043000_add_google_calendar_agenda/migration.sql',
  ), 'utf8')

  it('enforces one Google account and one CRM default calendar per user connection', () => {
    expect(sql).toContain('"CalendarIntegration_user_provider_key"')
    expect(sql).toContain('ON "CalendarIntegration"("userId", "provider")')
    expect(sql).toContain('"CalendarSource_one_crm_default_key"')
    expect(sql).toContain('WHERE "crmDefault" = true')
  })

  it('protects event time shapes and durable outbox invariants', () => {
    expect(sql).toContain('CONSTRAINT "CalendarEvent_time_shape_check"')
    expect(sql).toContain('"endDate" > "startDate"')
    expect(sql).toContain('"endsAt" > "startsAt"')
    expect(sql).toContain('CONSTRAINT "CalendarSyncJob_attempts_check"')
    expect(sql).toContain('"idempotencyKey" TEXT NOT NULL')
  })

  it('persists recurrence, reminders, invite policy and mutation intent', () => {
    expect(sql).toContain('"recurrence" TEXT[] NOT NULL')
    expect(sql).toContain('"reminders" JSONB')
    expect(sql).toContain('"sendInvites" BOOLEAN NOT NULL')
    expect(sql).toContain('"payload" JSONB')
  })

  it('cannot persist partial encrypted token envelopes', () => {
    expect(sql).toContain('CONSTRAINT "CalendarIntegration_access_token_shape_check"')
    expect(sql).toContain('CONSTRAINT "CalendarIntegration_refresh_token_shape_check"')
  })
})
