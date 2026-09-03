import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260902113000_add_admin_provisioned_access/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('admin-provisioned access migration safety', () => {
  it('is additive and does not reclassify existing users or subscriptions', () => {
    expect(migration).toContain('CREATE TABLE "AdminProvisionedAccess"')
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"AdminProvisionedAccess"/i)
    expect(migration).not.toMatch(/UPDATE\s+"(?:user|Agent|PlatformSubscription)"/i)
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN|TYPE)/i)
  })

  it('binds one agent to one exact commercial subscription', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "AdminProvisionedAccess_agentId_key"')
    expect(migration).toContain('CREATE UNIQUE INDEX "AdminProvisionedAccess_platformSubscriptionId_key"')
    expect(migration).toContain('FOREIGN KEY ("agentId") REFERENCES "Agent"("id")')
    expect(migration).toContain(
      'FOREIGN KEY ("platformSubscriptionId") REFERENCES "PlatformSubscription"("id")',
    )
    expect(migration).toContain('ON DELETE RESTRICT')
  })

  it('stores typed modules and requires a bounded reason for a payment hold', () => {
    for (const moduleName of [
      'TODAY',
      'CALENDAR',
      'CRM',
      'MESSAGES',
      'POLICIES',
      'ILLUSTRATIONS',
      'COMMISSIONS',
      'JOURNEY',
      'AGENCY',
      'TEAM',
      'INTEGRATIONS',
    ]) {
      expect(migration).toContain(`'${moduleName}'`)
    }
    expect(migration).toContain('"modules" "PlatformModule"[] NOT NULL')
    expect(migration).toContain('CONSTRAINT "AdminProvisionedAccess_payment_requirement"')
    expect(migration).toContain('char_length("paymentReason") <= 240')
  })

  it('keeps both the original and latest Keepr One manager traceable', () => {
    expect(migration).toContain('FOREIGN KEY ("provisionedById") REFERENCES "user"("id")')
    expect(migration).toContain('FOREIGN KEY ("updatedById") REFERENCES "user"("id")')
    expect(migration).toContain('CREATE INDEX "AdminProvisionedAccess_provisionedById_createdAt_idx"')
  })
})
