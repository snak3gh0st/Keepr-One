-- Current invited-agent subscriptions are only valid for active MEMBER rows,
-- and current agency subscriptions are only valid while an active OWNER exists.
-- Refuse to install the guards over data that already violates either rule.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "PlatformSubscription" AS subscription
      JOIN "AgencyMembership" AS membership
        ON membership."id" = subscription."agencyMembershipId"
      WHERE subscription."plan" = 'AGENT_AGENCY_MEMBER'
        AND subscription."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
        AND (
          membership."role" <> 'MEMBER'
          OR membership."endedAt" IS NOT NULL
        )
  ) THEN
    RAISE EXCEPTION 'Cannot install membership guards: a current invited-agent plan is not attached to an active MEMBER';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "PlatformSubscription" AS subscription
      WHERE subscription."plan" = 'AGENCY'
        AND subscription."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
        AND NOT EXISTS (
          SELECT 1
            FROM "AgencyMembership" AS membership
            WHERE membership."agencyId" = subscription."agencyId"
              AND membership."role" = 'OWNER'
              AND membership."endedAt" IS NULL
        )
  ) THEN
    RAISE EXCEPTION 'Cannot install membership guards: a current agency plan has no active OWNER';
  END IF;
END;
$$;

-- Every transition that can change the commercial subject uses this exact
-- advisory-lock namespace. The membership trigger takes the lock before it
-- mutates a row; the subscription trigger revalidates the membership after it
-- obtains the same lock. This closes the read-before-lock race.
CREATE FUNCTION "lock_platform_subscription_agent"(subject_agent_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF subject_agent_id IS NULL THEN
    RAISE EXCEPTION 'Cannot lock a null platform-subscription agent subject';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('keepr:platform-subscription:agent:' || subject_agent_id, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_platform_subscription_subject_state"()
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
        AND membership."role" = 'MEMBER'
        AND membership."endedAt" IS NULL;

    IF subject_agent_id IS NULL THEN
      RAISE EXCEPTION 'Current invited-agent subscription requires an active MEMBER agency membership';
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

  PERFORM "lock_platform_subscription_agent"(subject_agent_id);

  -- The first lookup is intentionally lock-free so it cannot deadlock with a
  -- membership update that already owns the advisory lock. Recheck after the
  -- lock to ensure that lookup did not race with an update or delete.
  IF NEW."plan" = 'AGENT_AGENCY_MEMBER' AND NOT EXISTS (
    SELECT 1
      FROM "AgencyMembership" AS membership
      WHERE membership."id" = NEW."agencyMembershipId"
        AND membership."agentId" = subject_agent_id
        AND membership."role" = 'MEMBER'
        AND membership."endedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Invited-agent membership changed while the subscription was being written; retry the operation';
  END IF;

  IF NEW."plan" = 'AGENCY' AND NOT EXISTS (
    SELECT 1
      FROM "AgencyMembership" AS membership
      WHERE membership."agencyId" = NEW."agencyId"
        AND membership."agentId" = subject_agent_id
        AND membership."role" = 'OWNER'
        AND membership."endedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Agency owner changed while the subscription was being written; retry the operation';
  END IF;

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
        AND membership."role" = 'MEMBER'
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

CREATE OR REPLACE FUNCTION "protect_current_agency_membership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_agent_id TEXT := OLD."agentId";
  new_agent_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    new_agent_id := NEW."agentId";
  END IF;

  -- When the agent identity changes, acquire both subject locks in lexical
  -- order so two opposing updates cannot deadlock each other.
  IF new_agent_id IS NOT NULL AND new_agent_id <> old_agent_id THEN
    IF old_agent_id < new_agent_id THEN
      PERFORM "lock_platform_subscription_agent"(old_agent_id);
      PERFORM "lock_platform_subscription_agent"(new_agent_id);
    ELSE
      PERFORM "lock_platform_subscription_agent"(new_agent_id);
      PERFORM "lock_platform_subscription_agent"(old_agent_id);
    END IF;
  ELSE
    PERFORM "lock_platform_subscription_agent"(old_agent_id);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "PlatformSubscription" AS subscription
      WHERE subscription."agencyMembershipId" = OLD."id"
        AND subscription."plan" = 'AGENT_AGENCY_MEMBER'
        AND subscription."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Cannot delete an agency member while their invited plan is current';
    END IF;

    IF NEW."endedAt" IS NOT NULL
      OR NEW."role" <> 'MEMBER'
      OR NEW."agentId" <> OLD."agentId"
      OR NEW."agencyId" <> OLD."agencyId"
    THEN
      RAISE EXCEPTION 'Cannot detach, promote, or replace an agency member while their invited plan is current';
    END IF;
  END IF;

  IF OLD."role" = 'OWNER' AND EXISTS (
    SELECT 1
      FROM "PlatformSubscription" AS subscription
      WHERE subscription."agencyId" = OLD."agencyId"
        AND subscription."plan" = 'AGENCY'
        AND subscription."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Cannot delete the owner while the agency plan is current';
    END IF;

    IF NEW."endedAt" IS NOT NULL
      OR NEW."role" <> 'OWNER'
      OR NEW."agentId" <> OLD."agentId"
      OR NEW."agencyId" <> OLD."agencyId"
    THEN
      RAISE EXCEPTION 'Cannot detach or replace the owner while the agency plan is current';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgencyMembership_current_plan_delete_guard"
  BEFORE DELETE
  ON "AgencyMembership"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_current_agency_membership"();
