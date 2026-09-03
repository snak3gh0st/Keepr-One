CREATE TYPE "AgentProfessionalRank" AS ENUM (
  'AGENT',
  'MANAGER',
  'DIRECTOR'
);

ALTER TABLE "AdminProvisionedAccess"
  ADD COLUMN "individualRank" "AgentProfessionalRank" NOT NULL DEFAULT 'AGENT';

-- Preserve the current professional progression for individual accounts.
-- AGENCY_OWNER is a structural role, so legacy agency owners safely fall back
-- to AGENT when no prior individual rank exists.
UPDATE "AdminProvisionedAccess" AS access
SET "individualRank" = CASE
  WHEN agent."rank" = 'MANAGER' THEN 'MANAGER'::"AgentProfessionalRank"
  WHEN agent."rank" = 'DIRECTOR' THEN 'DIRECTOR'::"AgentProfessionalRank"
  ELSE 'AGENT'::"AgentProfessionalRank"
END
FROM "Agent" AS agent
WHERE agent."id" = access."agentId";
