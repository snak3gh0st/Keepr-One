-- A subagency is a separate commercial workspace. Its owner keeps exactly one
-- active AgencyMembership (OWNER of the child), while this relation records
-- which agency is above it without weakening the one-membership-per-agent rule.
ALTER TABLE "Agency"
  ADD COLUMN "parentAgencyId" TEXT;

ALTER TABLE "Agency"
  ADD CONSTRAINT "Agency_not_its_own_parent" CHECK (
    "parentAgencyId" IS NULL OR "parentAgencyId" <> "id"
  );

CREATE INDEX "Agency_parentAgencyId_idx"
  ON "Agency"("parentAgencyId");

ALTER TABLE "Agency"
  ADD CONSTRAINT "Agency_parentAgencyId_fkey"
  FOREIGN KEY ("parentAgencyId") REFERENCES "Agency"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Plan and membership identify the exact commercial subject created when an
-- invitation is accepted. Existing builds did not have an acceptance route,
-- so refuse to guess if an environment contains hand-written accepted rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "AgencyInvitation"
      WHERE "status" = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'Accepted agency invitations must be backfilled before installing the commercial hierarchy';
  END IF;
END;
$$;

ALTER TABLE "AgencyInvitation"
  ADD COLUMN "acceptedPlan" "PlatformPlan",
  ADD COLUMN "acceptedMembershipId" TEXT;

CREATE UNIQUE INDEX "AgencyInvitation_acceptedMembershipId_key"
  ON "AgencyInvitation"("acceptedMembershipId");

ALTER TABLE "AgencyInvitation"
  ADD CONSTRAINT "AgencyInvitation_acceptedMembershipId_fkey"
  FOREIGN KEY ("acceptedMembershipId") REFERENCES "AgencyMembership"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgencyInvitation"
  DROP CONSTRAINT "AgencyInvitation_valid_lifecycle";

ALTER TABLE "AgencyInvitation"
  ADD CONSTRAINT "AgencyInvitation_accepted_plan" CHECK (
    "acceptedPlan" IS NULL
    OR "acceptedPlan" IN ('AGENCY', 'AGENT_AGENCY_MEMBER')
  ),
  ADD CONSTRAINT "AgencyInvitation_valid_lifecycle" CHECK (
    (
      "status" = 'PENDING'
      AND "acceptedAt" IS NULL
      AND "acceptedAgentId" IS NULL
      AND "acceptedPlan" IS NULL
      AND "acceptedMembershipId" IS NULL
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'ACCEPTED'
      AND "acceptedAt" IS NOT NULL
      AND "acceptedAgentId" IS NOT NULL
      AND "acceptedPlan" IS NOT NULL
      AND "acceptedMembershipId" IS NOT NULL
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'REVOKED'
      AND "acceptedAt" IS NULL
      AND "acceptedAgentId" IS NULL
      AND "acceptedPlan" IS NULL
      AND "acceptedMembershipId" IS NULL
      AND "revokedAt" IS NOT NULL
    )
    OR (
      "status" = 'EXPIRED'
      AND "acceptedAt" IS NULL
      AND "acceptedAgentId" IS NULL
      AND "acceptedPlan" IS NULL
      AND "acceptedMembershipId" IS NULL
      AND "revokedAt" IS NULL
    )
  );

-- Hierarchy writes are rare. A single transaction-scoped advisory lock keeps
-- two concurrent attachments from observing one another half-written (A -> B
-- and B -> A), which row locks alone cannot safely prevent for an arbitrary
-- depth graph. Once attached, a child cannot be detached or reparented in this
-- first version; roots may be attached exactly once by an accepted invitation.
CREATE FUNCTION "guard_commercial_agency_hierarchy"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  creates_cycle BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW."parentAgencyId" IS NOT DISTINCT FROM OLD."parentAgencyId"
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."parentAgencyId" IS NOT NULL THEN
    RAISE EXCEPTION 'A commercial subagency cannot be detached or reparented';
  END IF;

  IF NEW."parentAgencyId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."parentAgencyId" = NEW."id" THEN
    RAISE EXCEPTION 'An agency cannot be its own commercial parent';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('keepr:commercial-agency-hierarchy', 0)
  );

  WITH RECURSIVE ancestors AS (
    SELECT agency."id", agency."parentAgencyId", ARRAY[agency."id"]::TEXT[] AS path
      FROM "Agency" AS agency
      WHERE agency."id" = NEW."parentAgencyId"

    UNION ALL

    SELECT parent."id", parent."parentAgencyId", ancestors.path || parent."id"
      FROM "Agency" AS parent
      JOIN ancestors ON parent."id" = ancestors."parentAgencyId"
      WHERE NOT parent."id" = ANY(ancestors.path)
  )
  SELECT EXISTS (
    SELECT 1 FROM ancestors WHERE "id" = NEW."id"
  ) INTO creates_cycle;

  IF creates_cycle THEN
    RAISE EXCEPTION 'Commercial agency hierarchy cannot contain a cycle';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Agency_commercial_hierarchy_guard"
  BEFORE INSERT OR UPDATE OF "parentAgencyId"
  ON "Agency"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_commercial_agency_hierarchy"();

-- Cross-table checks bind the accepted invitation to the membership it
-- actually created. This prevents a caller from attaching an unrelated agent
-- or agency by supplying otherwise-valid identifiers.
CREATE FUNCTION "guard_agency_invitation_acceptance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  accepted_membership "AgencyMembership"%ROWTYPE;
  accepted_child_parent_id TEXT;
BEGIN
  IF NEW."status" <> 'ACCEPTED' THEN
    RETURN NEW;
  END IF;

  SELECT membership.*
    INTO accepted_membership
    FROM "AgencyMembership" AS membership
    WHERE membership."id" = NEW."acceptedMembershipId";

  IF accepted_membership."id" IS NULL
    OR accepted_membership."endedAt" IS NOT NULL
    OR accepted_membership."agentId" <> NEW."acceptedAgentId"
  THEN
    RAISE EXCEPTION 'Accepted invitation must reference its active agent membership';
  END IF;

  IF NEW."acceptedPlan" = 'AGENT_AGENCY_MEMBER' THEN
    IF accepted_membership."role" <> 'MEMBER'
      OR accepted_membership."agencyId" <> NEW."agencyId"
    THEN
      RAISE EXCEPTION 'Invited-agent plan must reference a MEMBER of the inviting agency';
    END IF;
  ELSIF NEW."acceptedPlan" = 'AGENCY' THEN
    SELECT agency."parentAgencyId"
      INTO accepted_child_parent_id
      FROM "Agency" AS agency
      WHERE agency."id" = accepted_membership."agencyId";

    IF accepted_membership."role" <> 'OWNER'
      OR accepted_child_parent_id IS DISTINCT FROM NEW."agencyId"
    THEN
      RAISE EXCEPTION 'Agency plan must reference the OWNER of a child agency';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accepted invitation has an unsupported commercial plan';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgencyInvitation_acceptance_guard"
  BEFORE INSERT OR UPDATE OF
    "status", "acceptedAt", "acceptedAgentId", "acceptedPlan", "acceptedMembershipId", "agencyId"
  ON "AgencyInvitation"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_agency_invitation_acceptance"();
