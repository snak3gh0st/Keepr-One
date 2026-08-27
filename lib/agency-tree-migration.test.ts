import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const hierarchyMigration = readFileSync(
  new URL(
    '../prisma/migrations/20260826102000_add_commercial_agency_hierarchy/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

const planMigration = readFileSync(
  new URL(
    '../prisma/migrations/20260826043000_add_platform_plan_access/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

const recruitmentMigration = readFileSync(
  new URL(
    '../prisma/migrations/20260826110000_add_agency_recruitment_pipeline/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

const invitationPriceMigration = readFileSync(
  new URL(
    '../prisma/migrations/20260826113000_allow_agency_invitation_plan_prices/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('commercial agency hierarchy migration safety', () => {
  it('keeps the one-active-membership-per-agent commercial invariant', () => {
    expect(planMigration).toContain(
      'CREATE UNIQUE INDEX "AgencyMembership_one_active_membership_per_agent"',
    )
    expect(planMigration).toContain('WHERE "endedAt" IS NULL')
    expect(hierarchyMigration).not.toContain(
      'DROP INDEX "AgencyMembership_one_active_membership_per_agent"',
    )
  })

  it('adds a downward-only agency relation protected against self and cyclic links', () => {
    expect(hierarchyMigration).toContain('ADD COLUMN "parentAgencyId" TEXT')
    expect(hierarchyMigration).toContain('CONSTRAINT "Agency_not_its_own_parent"')
    expect(hierarchyMigration).toContain('WITH RECURSIVE ancestors AS')
    expect(hierarchyMigration).toContain(
      "hashtextextended('keepr:commercial-agency-hierarchy', 0)",
    )
    expect(hierarchyMigration).toContain(
      "RAISE EXCEPTION 'A commercial subagency cannot be detached or reparented'",
    )
  })

  it('requires every accepted invitation to identify its plan and exact membership', () => {
    expect(hierarchyMigration).toContain(
      'ADD COLUMN "acceptedPlan" "PlatformPlan"',
    )
    expect(hierarchyMigration).toContain(
      'ADD COLUMN "acceptedMembershipId" TEXT',
    )
    expect(hierarchyMigration).toContain(
      'CREATE UNIQUE INDEX "AgencyInvitation_acceptedMembershipId_key"',
    )
    expect(hierarchyMigration).toContain(
      'AND "acceptedPlan" IS NOT NULL',
    )
    expect(hierarchyMigration).toContain(
      'AND "acceptedMembershipId" IS NOT NULL',
    )
  })

  it('binds agent acceptance to the inviting agency and agency acceptance to its child', () => {
    expect(hierarchyMigration).toContain(
      'CREATE FUNCTION "guard_agency_invitation_acceptance"()',
    )
    expect(hierarchyMigration).toContain(
      "accepted_membership.\"role\" <> 'MEMBER'",
    )
    expect(hierarchyMigration).toContain(
      'accepted_membership."agencyId" <> NEW."agencyId"',
    )
    expect(hierarchyMigration).toContain(
      "accepted_membership.\"role\" <> 'OWNER'",
    )
    expect(hierarchyMigration).toContain(
      'accepted_child_parent_id IS DISTINCT FROM NEW."agencyId"',
    )
  })

  it('adds a typed recruitment pipeline without guessing pending legacy invitations', () => {
    expect(recruitmentMigration).toContain(
      'CREATE TYPE "AgencyInvitationIntendedType" AS ENUM',
    )
    expect(recruitmentMigration).toContain(
      'CREATE TYPE "AgencyRecruitmentStage" AS ENUM',
    )
    for (const stage of [
      'PROSPECT',
      'CONTACTED',
      'MEETING_SCHEDULED',
      'QUALIFIED',
      'INVITED',
      'ONBOARDING',
      'ACTIVE',
      'PAUSED',
      'DECLINED',
    ]) {
      expect(recruitmentMigration).toContain(`'${stage}'`)
    }
    expect(recruitmentMigration).toContain(
      'ADD COLUMN "intendedType" "AgencyInvitationIntendedType"',
    )
    expect(recruitmentMigration).not.toContain(
      'ADD COLUMN "intendedType" "AgencyInvitationIntendedType" NOT NULL',
    )
    expect(recruitmentMigration).toContain(
      'ADD COLUMN "recruitmentStage" "AgencyRecruitmentStage" NOT NULL DEFAULT \'INVITED\'',
    )
    expect(recruitmentMigration).toContain(
      'ADD COLUMN "stageUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    )
  })

  it('backfills only inferable accepted types and rejects incompatible plan/type pairs', () => {
    expect(recruitmentMigration).toContain(
      'Cannot add recruitment pipeline: an accepted invitation has no compatible commercial plan',
    )
    expect(recruitmentMigration).toContain(
      "WHEN 'AGENCY' THEN 'AGENCY'::\"AgencyInvitationIntendedType\"",
    )
    expect(recruitmentMigration).toContain(
      "WHEN 'AGENT_AGENCY_MEMBER' THEN 'AGENT'::\"AgencyInvitationIntendedType\"",
    )
    expect(recruitmentMigration).toContain(
      'CONSTRAINT "AgencyInvitation_accepted_intended_type"',
    )
    expect(recruitmentMigration).toContain(
      'CONSTRAINT "AgencyInvitation_active_stage_requires_acceptance"',
    )
    expect(recruitmentMigration).toContain(
      'CONSTRAINT "AgencyInvitation_intended_type_matches_accepted_plan"',
    )
    expect(recruitmentMigration).toContain(
      '"intendedType" = \'AGENT\'',
    )
    expect(recruitmentMigration).toContain(
      '"acceptedPlan" = \'AGENT_AGENCY_MEMBER\'',
    )
    expect(recruitmentMigration).toContain(
      '"intendedType" = \'AGENCY\'',
    )
    expect(recruitmentMigration).toContain(
      '"acceptedPlan" = \'AGENCY\'',
    )
  })

  it('indexes the agency recruitment board without weakening existing hierarchy guards', () => {
    expect(recruitmentMigration).toContain(
      'CREATE INDEX "AgencyInvitation_agencyId_recruitmentStage_status_idx"',
    )
    expect(recruitmentMigration).toContain(
      'ON "AgencyInvitation"("agencyId", "recruitmentStage", "status")',
    )
    expect(recruitmentMigration).not.toContain('DROP CONSTRAINT')
    expect(recruitmentMigration).not.toContain('DROP INDEX')
    expect(recruitmentMigration).not.toContain('DROP COLUMN')
  })

  it('replaces the legacy one-price guard with prices bound to the invitation type', () => {
    expect(invitationPriceMigration).toContain(
      'DROP CONSTRAINT "AgencyInvitation_discounted_price"',
    )
    expect(invitationPriceMigration).toContain(
      'ADD CONSTRAINT "AgencyInvitation_plan_price"',
    )
    expect(invitationPriceMigration).toContain(
      '"intendedType" = \'AGENT\'',
    )
    expect(invitationPriceMigration).toContain(
      '"monthlyPriceCents" = 4990',
    )
    expect(invitationPriceMigration).toContain(
      '"intendedType" = \'AGENCY\'',
    )
    expect(invitationPriceMigration).toContain(
      '"monthlyPriceCents" = 9990',
    )
  })
})
