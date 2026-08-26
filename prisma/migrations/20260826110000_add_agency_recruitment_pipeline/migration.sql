CREATE TYPE "AgencyInvitationIntendedType" AS ENUM (
  'AGENT',
  'AGENCY'
);

CREATE TYPE "AgencyRecruitmentStage" AS ENUM (
  'PROSPECT',
  'CONTACTED',
  'MEETING_SCHEDULED',
  'QUALIFIED',
  'INVITED',
  'ONBOARDING',
  'ACTIVE',
  'PAUSED',
  'DECLINED'
);

ALTER TABLE "AgencyInvitation"
  ADD COLUMN "intendedType" "AgencyInvitationIntendedType",
  ADD COLUMN "recruitmentStage" "AgencyRecruitmentStage" NOT NULL DEFAULT 'INVITED',
  ADD COLUMN "stageUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Accepted invitations already identify the exact commercial plan, so their
-- intended type can be backfilled without guessing. Pending legacy invitations
-- deliberately stay null and retain their former choose-at-acceptance behavior
-- until they expire or are reissued by the inviting agency.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "AgencyInvitation"
      WHERE "status" = 'ACCEPTED'
        AND (
          "acceptedPlan" IS NULL
          OR "acceptedPlan" NOT IN ('AGENCY', 'AGENT_AGENCY_MEMBER')
        )
  ) THEN
    RAISE EXCEPTION 'Cannot add recruitment pipeline: an accepted invitation has no compatible commercial plan';
  END IF;
END;
$$;

UPDATE "AgencyInvitation"
SET
  "intendedType" = CASE "acceptedPlan"
    WHEN 'AGENCY' THEN 'AGENCY'::"AgencyInvitationIntendedType"
    WHEN 'AGENT_AGENCY_MEMBER' THEN 'AGENT'::"AgencyInvitationIntendedType"
    ELSE NULL
  END,
  "recruitmentStage" = CASE
    WHEN "status" = 'ACCEPTED' THEN 'ACTIVE'::"AgencyRecruitmentStage"
    ELSE 'INVITED'::"AgencyRecruitmentStage"
  END,
  "stageUpdatedAt" = CASE
    WHEN "status" = 'ACCEPTED' THEN COALESCE("acceptedAt", "updatedAt", "createdAt")
    ELSE "createdAt"
  END;

ALTER TABLE "AgencyInvitation"
  ADD CONSTRAINT "AgencyInvitation_accepted_intended_type" CHECK (
    "status" <> 'ACCEPTED' OR "intendedType" IS NOT NULL
  ),
  ADD CONSTRAINT "AgencyInvitation_active_stage_requires_acceptance" CHECK (
    "recruitmentStage" <> 'ACTIVE' OR "status" = 'ACCEPTED'
  ),
  ADD CONSTRAINT "AgencyInvitation_intended_type_matches_accepted_plan" CHECK (
    "acceptedPlan" IS NULL
    OR "intendedType" IS NULL
    OR (
      "intendedType" = 'AGENT'
      AND "acceptedPlan" = 'AGENT_AGENCY_MEMBER'
    )
    OR (
      "intendedType" = 'AGENCY'
      AND "acceptedPlan" = 'AGENCY'
    )
  );

CREATE INDEX "AgencyInvitation_agencyId_recruitmentStage_status_idx"
  ON "AgencyInvitation"("agencyId", "recruitmentStage", "status");
