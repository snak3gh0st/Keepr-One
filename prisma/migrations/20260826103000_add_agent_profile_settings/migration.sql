-- The agent phone is a canonical profile value. FounderEnrollment keeps the
-- immutable registration snapshot, while Agent.phone may evolve with the
-- authenticated person's profile.
ALTER TABLE "Agent"
  ADD COLUMN "phone" TEXT;

UPDATE "Agent" AS agent
SET "phone" = enrollment."phone"
FROM "FounderEnrollment" AS enrollment
WHERE enrollment."agentId" = agent."id"
  AND agent."phone" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Agent"
    WHERE "phone" IS NOT NULL
      AND "phone" !~ '^\+?[0-9]{7,15}$'
  ) THEN
    RAISE EXCEPTION 'Agent phone backfill contains an invalid normalized value';
  END IF;
END;
$$;

ALTER TABLE "Agent"
  ADD CONSTRAINT "Agent_phone_normalized_shape" CHECK (
    "phone" IS NULL
    OR "phone" ~ '^\+?[0-9]{7,15}$'
  );

-- Refuse to merge two existing identities. This preflight deliberately runs
-- before the UPDATE that lowercases and trims email addresses.
DO $$
BEGIN
  IF EXISTS (
    SELECT lower(btrim("email"))
    FROM "user"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Case-insensitive duplicate user emails require manual resolution';
  END IF;
END;
$$;

UPDATE "user"
SET
  "email" = lower(btrim("email")),
  "name" = btrim("name"),
  "timeZone" = btrim("timeZone")
WHERE "email" IS DISTINCT FROM lower(btrim("email"))
   OR "name" IS DISTINCT FROM btrim("name")
   OR "timeZone" IS DISTINCT FROM btrim("timeZone");

UPDATE "Agency"
SET "name" = btrim("name")
WHERE "name" IS DISTINCT FROM btrim("name");

ALTER TABLE "user"
  ADD CONSTRAINT "user_name_profile_shape" CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 2 AND 100
  ) NOT VALID,
  ADD CONSTRAINT "user_timeZone_profile_shape" CHECK (
    "timeZone" = btrim("timeZone")
    AND char_length("timeZone") BETWEEN 1 AND 100
  ) NOT VALID,
  ADD CONSTRAINT "user_email_normalized" CHECK (
    "email" = lower(btrim("email"))
    AND char_length("email") BETWEEN 3 AND 254
  );

ALTER TABLE "Agency"
  ADD CONSTRAINT "Agency_name_profile_shape" CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 2 AND 120
  ) NOT VALID;

-- Keep Prisma's ordinary @unique index and add the database-level expression
-- index so case-insensitive identity remains protected for every writer.
CREATE UNIQUE INDEX "user_email_case_insensitive_key"
  ON "user" (lower("email"));
