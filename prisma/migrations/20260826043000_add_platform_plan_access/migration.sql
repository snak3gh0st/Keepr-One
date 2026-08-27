CREATE TYPE "PlatformPlan" AS ENUM (
  'AGENT_INDIVIDUAL',
  'AGENCY',
  'AGENT_AGENCY_MEMBER'
);

CREATE TYPE "PlatformSubscriptionStatus" AS ENUM (
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED'
);

CREATE TYPE "AgencyMembershipRole" AS ENUM ('OWNER', 'MEMBER');

CREATE TYPE "AgencyInvitationStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE "Agency" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Agency_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Agency_name_not_blank" CHECK (btrim("name") <> '')
);

CREATE TABLE "AgencyMembership" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "role" "AgencyMembershipRole" NOT NULL,
  "invitedByAgentId" TEXT,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgencyMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgencyMembership_valid_period" CHECK (
    "endedAt" IS NULL OR "endedAt" >= "joinedAt"
  )
);

CREATE TABLE "AgencyInvitation" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "invitedByAgentId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "AgencyInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "monthlyPriceCents" INTEGER NOT NULL DEFAULT 4990,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedAgentId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgencyInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgencyInvitation_email_not_blank" CHECK (btrim("email") <> ''),
  CONSTRAINT "AgencyInvitation_discounted_price" CHECK ("monthlyPriceCents" = 4990),
  CONSTRAINT "AgencyInvitation_valid_lifecycle" CHECK (
    (
      "status" = 'PENDING'
      AND "acceptedAt" IS NULL
      AND "acceptedAgentId" IS NULL
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'ACCEPTED'
      AND "acceptedAt" IS NOT NULL
      AND "acceptedAgentId" IS NOT NULL
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'REVOKED'
      AND "acceptedAt" IS NULL
      AND "acceptedAgentId" IS NULL
      AND "revokedAt" IS NOT NULL
    )
    OR (
      "status" = 'EXPIRED'
      AND "acceptedAt" IS NULL
      AND "acceptedAgentId" IS NULL
      AND "revokedAt" IS NULL
    )
  )
);

CREATE TABLE "PlatformSubscription" (
  "id" TEXT NOT NULL,
  "plan" "PlatformPlan" NOT NULL,
  "status" "PlatformSubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "agentId" TEXT,
  "agencyId" TEXT,
  "agencyMembershipId" TEXT,
  "unitAmountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlatformSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformSubscription_amount_nonnegative" CHECK ("unitAmountCents" >= 0),
  CONSTRAINT "PlatformSubscription_member_discounted_price" CHECK (
    "plan" <> 'AGENT_AGENCY_MEMBER' OR "unitAmountCents" = 4990
  ),
  CONSTRAINT "PlatformSubscription_currency_iso_shape" CHECK (
    char_length("currency") = 3 AND "currency" = upper("currency")
  ),
  CONSTRAINT "PlatformSubscription_valid_period" CHECK (
    "currentPeriodStart" IS NULL
    OR "currentPeriodEnd" IS NULL
    OR "currentPeriodEnd" >= "currentPeriodStart"
  ),
  CONSTRAINT "PlatformSubscription_plan_subject" CHECK (
    (
      "plan" = 'AGENT_INDIVIDUAL'
      AND "agentId" IS NOT NULL
      AND "agencyId" IS NULL
      AND "agencyMembershipId" IS NULL
    )
    OR (
      "plan" = 'AGENCY'
      AND "agentId" IS NULL
      AND "agencyId" IS NOT NULL
      AND "agencyMembershipId" IS NULL
    )
    OR (
      "plan" = 'AGENT_AGENCY_MEMBER'
      AND "agentId" IS NULL
      AND "agencyId" IS NULL
      AND "agencyMembershipId" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "AgencyMembership_one_active_membership_per_agent"
  ON "AgencyMembership"("agentId")
  WHERE "endedAt" IS NULL;

CREATE UNIQUE INDEX "AgencyMembership_one_active_owner_per_agency"
  ON "AgencyMembership"("agencyId")
  WHERE "role" = 'OWNER' AND "endedAt" IS NULL;

CREATE INDEX "AgencyMembership_agencyId_endedAt_idx"
  ON "AgencyMembership"("agencyId", "endedAt");

CREATE INDEX "AgencyMembership_agentId_endedAt_idx"
  ON "AgencyMembership"("agentId", "endedAt");

CREATE INDEX "AgencyMembership_invitedByAgentId_idx"
  ON "AgencyMembership"("invitedByAgentId");

CREATE UNIQUE INDEX "AgencyInvitation_tokenHash_key"
  ON "AgencyInvitation"("tokenHash");

CREATE UNIQUE INDEX "AgencyInvitation_one_pending_email_per_agency"
  ON "AgencyInvitation"("agencyId", lower("email"))
  WHERE "status" = 'PENDING';

CREATE INDEX "AgencyInvitation_agencyId_status_idx"
  ON "AgencyInvitation"("agencyId", "status");

CREATE INDEX "AgencyInvitation_invitedByAgentId_idx"
  ON "AgencyInvitation"("invitedByAgentId");

CREATE INDEX "AgencyInvitation_acceptedAgentId_idx"
  ON "AgencyInvitation"("acceptedAgentId");

-- PAST_DUE is not entitled in application code, but it remains the current
-- billing record and must not be duplicated while recovery is attempted.
CREATE UNIQUE INDEX "PlatformSubscription_one_current_agent"
  ON "PlatformSubscription"("agentId")
  WHERE "agentId" IS NOT NULL
    AND "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

CREATE UNIQUE INDEX "PlatformSubscription_one_current_agency"
  ON "PlatformSubscription"("agencyId")
  WHERE "agencyId" IS NOT NULL
    AND "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

CREATE UNIQUE INDEX "PlatformSubscription_one_current_membership"
  ON "PlatformSubscription"("agencyMembershipId")
  WHERE "agencyMembershipId" IS NOT NULL
    AND "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

CREATE INDEX "PlatformSubscription_agentId_status_idx"
  ON "PlatformSubscription"("agentId", "status");

CREATE INDEX "PlatformSubscription_agencyId_status_idx"
  ON "PlatformSubscription"("agencyId", "status");

CREATE INDEX "PlatformSubscription_agencyMembershipId_status_idx"
  ON "PlatformSubscription"("agencyMembershipId", "status");

ALTER TABLE "AgencyMembership"
  ADD CONSTRAINT "AgencyMembership_agencyId_fkey"
  FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgencyMembership"
  ADD CONSTRAINT "AgencyMembership_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgencyMembership"
  ADD CONSTRAINT "AgencyMembership_invitedByAgentId_fkey"
  FOREIGN KEY ("invitedByAgentId") REFERENCES "Agent"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgencyInvitation"
  ADD CONSTRAINT "AgencyInvitation_agencyId_fkey"
  FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgencyInvitation"
  ADD CONSTRAINT "AgencyInvitation_invitedByAgentId_fkey"
  FOREIGN KEY ("invitedByAgentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgencyInvitation"
  ADD CONSTRAINT "AgencyInvitation_acceptedAgentId_fkey"
  FOREIGN KEY ("acceptedAgentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformSubscription"
  ADD CONSTRAINT "PlatformSubscription_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformSubscription"
  ADD CONSTRAINT "PlatformSubscription_agencyId_fkey"
  FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformSubscription"
  ADD CONSTRAINT "PlatformSubscription_agencyMembershipId_fkey"
  FOREIGN KEY ("agencyMembershipId") REFERENCES "AgencyMembership"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
