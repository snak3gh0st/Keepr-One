import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../prisma/migrations/20260812020000_add_dynamic_crm_followups_notifications/migration.sql', import.meta.url),
  'utf8',
)

describe('CRM migration safety', () => {
  it('enforces one active stage per pipeline position at the database boundary', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "CrmStage_pipelineId_active_position_key"')
    expect(migration).toContain('ON "CrmStage"("pipelineId", "position") WHERE "active" = true')
  })

  it('losslessly ranks duplicate open legacy follow-ups before adding partial uniqueness', () => {
    const backfill = migration.indexOf('INSERT INTO "FollowUp"')
    const closeCancelledTimeline = migration.indexOf('UPDATE "CaseTimelineEvent" AS timeline')
    const unique = migration.indexOf('CREATE UNIQUE INDEX "FollowUp_one_scheduled_per_case_key"')
    expect(backfill).toBeGreaterThan(-1)
    expect(closeCancelledTimeline).toBeGreaterThan(backfill)
    expect(unique).toBeGreaterThan(closeCancelledTimeline)
    expect(unique).toBeGreaterThan(backfill)
    expect(migration).toContain('ROW_NUMBER() OVER')
    expect(migration).toContain("WHEN e.\"open_rank\" = 1 THEN 'SCHEDULED'")
    expect(migration).toContain("ELSE 'CANCELLED'::\"FollowUpStatus\"")
    expect(migration).toContain('SET "doneAt" = follow_up."cancelledAt" AT TIME ZONE \'UTC\'')
    expect(migration).toContain('follow_up."status" = \'CANCELLED\'::"FollowUpStatus"')
    expect(migration).toContain('not every legacy follow-up was backfilled')
  })
})
