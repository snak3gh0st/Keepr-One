ALTER TABLE "PlatformSubscription"
  ADD CONSTRAINT "PlatformSubscription_member_currency_usd" CHECK (
    "plan" <> 'AGENT_AGENCY_MEMBER' OR "currency" = 'USD'
  );

-- Commercial subjects live in three different tables, so ordinary UNIQUE and
-- CHECK constraints cannot prevent one person from holding two current plans.
-- Serialize transitions per agent and reject contradictory combinations.
CREATE FUNCTION "enforce_platform_subscription_subject_state"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  subject_agent_id TEXT;
BEGIN
  IF NEW."status" NOT IN ('TRIALING', 'ACTIVE', 'PAST_DUE') THEN
    RETURN NEW;
  END IF;

  IF NEW."plan" = 'AGENT_INDIVIDUAL' THEN
    subject_agent_id := NEW."agentId";
  ELSIF NEW."plan" = 'AGENT_AGENCY_MEMBER' THEN
    SELECT membership."agentId"
      INTO subject_agent_id
      FROM "AgencyMembership" AS membership
      WHERE membership."id" = NEW."agencyMembershipId"
        AND membership."endedAt" IS NULL;

    IF subject_agent_id IS NULL THEN
      RAISE EXCEPTION 'Current invited-agent subscription requires an active agency membership';
    END IF;
  ELSIF NEW."plan" = 'AGENCY' THEN
    SELECT membership."agentId"
      INTO subject_agent_id
      FROM "AgencyMembership" AS membership
      WHERE membership."agencyId" = NEW."agencyId"
        AND membership."role" = 'OWNER'
        AND membership."endedAt" IS NULL;

    IF subject_agent_id IS NULL THEN
      RAISE EXCEPTION 'Current agency subscription requires an active agency owner';
    END IF;
  END IF;

  IF subject_agent_id IS NULL THEN
    RAISE EXCEPTION 'Current platform subscription has no resolvable agent subject';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(subject_agent_id, 0));

  IF NEW."plan" <> 'AGENT_INDIVIDUAL' AND EXISTS (
    SELECT 1
      FROM "PlatformSubscription" AS subscription
      WHERE subscription."agentId" = subject_agent_id
        AND subscription."plan" = 'AGENT_INDIVIDUAL'
        AND subscription."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
        AND subscription."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'Agent already has a current individual subscription';
  END IF;

  IF NEW."plan" = 'AGENT_INDIVIDUAL' AND EXISTS (
    SELECT 1
      FROM "PlatformSubscription" AS subscription
      JOIN "AgencyMembership" AS membership
        ON membership."id" = subscription."agencyMembershipId"
      WHERE membership."agentId" = subject_agent_id
        AND membership."endedAt" IS NULL
        AND subscription."plan" = 'AGENT_AGENCY_MEMBER'
        AND subscription."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
        AND subscription."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'Agent already has a current invited-agency subscription';
  END IF;

  IF NEW."plan" = 'AGENT_INDIVIDUAL' AND EXISTS (
    SELECT 1
      FROM "PlatformSubscription" AS subscription
      JOIN "AgencyMembership" AS membership
        ON membership."agencyId" = subscription."agencyId"
      WHERE membership."agentId" = subject_agent_id
        AND membership."role" = 'OWNER'
        AND membership."endedAt" IS NULL
        AND subscription."plan" = 'AGENCY'
        AND subscription."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
        AND subscription."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'Agent already owns a current agency subscription';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PlatformSubscription_subject_state_guard"
  BEFORE INSERT OR UPDATE OF
    "plan", "status", "agentId", "agencyId", "agencyMembershipId"
  ON "PlatformSubscription"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_platform_subscription_subject_state"();

CREATE FUNCTION "protect_current_agency_membership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "PlatformSubscription" AS subscription
      WHERE subscription."agencyMembershipId" = OLD."id"
        AND subscription."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
  ) AND (
    NEW."endedAt" IS NOT NULL
    OR NEW."agentId" <> OLD."agentId"
    OR NEW."agencyId" <> OLD."agencyId"
  ) THEN
    RAISE EXCEPTION 'Cannot detach an agency member while their invited plan is current';
  END IF;

  IF OLD."role" = 'OWNER' AND EXISTS (
    SELECT 1
      FROM "PlatformSubscription" AS subscription
      WHERE subscription."agencyId" = OLD."agencyId"
        AND subscription."plan" = 'AGENCY'
        AND subscription."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
  ) AND (
    NEW."endedAt" IS NOT NULL
    OR NEW."role" <> 'OWNER'
    OR NEW."agentId" <> OLD."agentId"
    OR NEW."agencyId" <> OLD."agencyId"
  ) THEN
    RAISE EXCEPTION 'Cannot detach or replace the owner while the agency plan is current';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgencyMembership_current_plan_guard"
  BEFORE UPDATE OF "endedAt", "role", "agentId", "agencyId"
  ON "AgencyMembership"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_current_agency_membership"();
