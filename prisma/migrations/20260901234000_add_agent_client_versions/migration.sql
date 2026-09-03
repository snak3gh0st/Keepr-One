ALTER TABLE "Agent"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Client"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "AgencyInvitation"
ADD COLUMN "isCurrentCommercial" BOOLEAN NOT NULL DEFAULT false;

WITH ranked_invitations AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "acceptedAgentId"
      ORDER BY "acceptedAt" DESC NULLS LAST, "createdAt" DESC, "id" DESC
    ) AS row_number
  FROM "AgencyInvitation"
  WHERE "status" = 'ACCEPTED'
    AND "acceptedAgentId" IS NOT NULL
)
UPDATE "AgencyInvitation" AS invitation
SET "isCurrentCommercial" = true
FROM ranked_invitations AS ranked
WHERE invitation."id" = ranked."id"
  AND ranked.row_number = 1;

CREATE UNIQUE INDEX "AgencyInvitation_current_commercial_agent_key"
ON "AgencyInvitation"("acceptedAgentId")
WHERE "isCurrentCommercial" = true;

CREATE INDEX "AgencyInvitation_acceptedAgentId_isCurrentCommercial_idx"
ON "AgencyInvitation"("acceptedAgentId", "isCurrentCommercial");

CREATE TABLE "AdminEmailChangeRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "originalEmail" TEXT NOT NULL,
  "originalEmailVerified" BOOLEAN NOT NULL,
  "newEmail" TEXT NOT NULL,
  "currentTokenHash" TEXT NOT NULL,
  "newTokenHash" TEXT,
  "expectedUserUpdatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "currentApprovedAt" TIMESTAMP(3),
  "newTokenExpiresAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdminEmailChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminEmailChangeRequest_userId_key"
ON "AdminEmailChangeRequest"("userId");

CREATE UNIQUE INDEX "AdminEmailChangeRequest_newEmail_key"
ON "AdminEmailChangeRequest"("newEmail");

CREATE UNIQUE INDEX "AdminEmailChangeRequest_currentTokenHash_key"
ON "AdminEmailChangeRequest"("currentTokenHash");

CREATE UNIQUE INDEX "AdminEmailChangeRequest_newTokenHash_key"
ON "AdminEmailChangeRequest"("newTokenHash");

CREATE INDEX "AdminEmailChangeRequest_expiresAt_idx"
ON "AdminEmailChangeRequest"("expiresAt");

CREATE INDEX "AdminEmailChangeRequest_requestedById_createdAt_idx"
ON "AdminEmailChangeRequest"("requestedById", "createdAt");

ALTER TABLE "AdminEmailChangeRequest"
ADD CONSTRAINT "AdminEmailChangeRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminEmailChangeRequest"
ADD CONSTRAINT "AdminEmailChangeRequest_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
