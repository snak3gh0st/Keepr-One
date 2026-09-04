import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260826104000_add_agent_onboarding/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

const nationalLifeSkipMigration = readFileSync(
  new URL(
    '../prisma/migrations/20260904123000_allow_skipping_national_life_onboarding/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('agent onboarding migration safety', () => {
  it('is incremental and keeps existing agents grandfathered', () => {
    expect(migration).toContain('CREATE TABLE "AgentOnboarding"')
    expect(migration).toContain('Deliberately no backfill')
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"AgentOnboarding"/i)
  })

  it('enforces one lifecycle per agent with cascade cleanup', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "AgentOnboarding_agentId_key"')
    expect(migration).toContain('FOREIGN KEY ("agentId") REFERENCES "Agent"("id")')
    expect(migration).toContain('ON DELETE CASCADE')
  })

  it('cannot complete without all durable prerequisites and required modules', () => {
    expect(migration).toContain('CONSTRAINT "AgentOnboarding_lifecycle"')
    expect(migration).toContain('"nationalLifeVerifiedAt" IS NOT NULL')
    expect(migration).toContain('"calendarDecision" IS NOT NULL')
    expect(migration).toContain('"whatsappDecision" IS NOT NULL')
    expect(migration).toContain('"requiredModules" <@ "completedModules"')
    expect(migration).toContain('"completedModules" <@ "requiredModules"')
  })
})

describe('National Life onboarding skip migration', () => {
  it('stores a skip separately from verified connector evidence', () => {
    expect(nationalLifeSkipMigration).toContain('ADD COLUMN "nationalLifeSkippedAt" TIMESTAMP(3)')
    expect(nationalLifeSkipMigration).toContain('CONSTRAINT "AgentOnboarding_national_life_outcome"')
    expect(nationalLifeSkipMigration).toContain('"nationalLifeVerificationSource" IS NULL')
  })

  it('allows completion through verification or an explicit skip', () => {
    expect(nationalLifeSkipMigration).toContain('DROP CONSTRAINT "AgentOnboarding_lifecycle"')
    expect(nationalLifeSkipMigration).toMatch(
      /DROP CONSTRAINT "AgentOnboarding_lifecycle",\s+ADD CONSTRAINT "AgentOnboarding_lifecycle"/,
    )
    expect(nationalLifeSkipMigration).toMatch(
      /"nationalLifeVerifiedAt" IS NOT NULL\s+OR "nationalLifeSkippedAt" IS NOT NULL/,
    )
    expect(nationalLifeSkipMigration).toContain('"calendarDecision" IS NOT NULL')
    expect(nationalLifeSkipMigration).toContain('"whatsappDecision" IS NOT NULL')
  })
})
