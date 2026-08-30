CREATE TYPE "ApplicationAutomationState" AS ENUM (
  'COLLECTING',
  'READY_FOR_REVIEW',
  'READY_TO_PREPARE',
  'PREPARING_DRAFT',
  'NEEDS_INFORMATION',
  'DRAFT_READY',
  'READY_TO_SUBMIT',
  'SUBMITTING',
  'SUBMITTED',
  'FAILED'
);

CREATE TYPE "PlatformAddon" AS ENUM ('K_BOT_APPLICATION');

CREATE TABLE "PlatformAddonSubscription" (
  "id" TEXT NOT NULL,
  "addon" "PlatformAddon" NOT NULL,
  "status" "PlatformSubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "agentId" TEXT NOT NULL,
  "unitAmountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "canceledAt" TIMESTAMP(3),
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripeProductId" TEXT,
  "stripePriceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlatformAddonSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformAddonSubscription_positive_price" CHECK ("unitAmountCents" > 0),
  CONSTRAINT "PlatformAddonSubscription_usd" CHECK ("currency" = 'USD')
);

CREATE UNIQUE INDEX "PlatformAddonSubscription_stripeSubscriptionId_key"
  ON "PlatformAddonSubscription"("stripeSubscriptionId");
CREATE INDEX "PlatformAddonSubscription_agentId_addon_status_idx"
  ON "PlatformAddonSubscription"("agentId", "addon", "status");
CREATE INDEX "PlatformAddonSubscription_stripeCustomerId_idx"
  ON "PlatformAddonSubscription"("stripeCustomerId");
CREATE INDEX "PlatformAddonSubscription_stripePriceId_idx"
  ON "PlatformAddonSubscription"("stripePriceId");
CREATE UNIQUE INDEX "PlatformAddonSubscription_one_current_agent_addon"
  ON "PlatformAddonSubscription"("agentId", "addon")
  WHERE "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

ALTER TABLE "PlatformAddonSubscription"
  ADD CONSTRAINT "PlatformAddonSubscription_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Application"
  ADD COLUMN "automationState" "ApplicationAutomationState" NOT NULL DEFAULT 'COLLECTING',
  ADD COLUMN "intakeVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "dossier" JSONB,
  ADD COLUMN "dossierHash" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "consentedAt" TIMESTAMP(3),
  ADD COLUMN "carrierReceipt" JSONB,
  ADD COLUMN "safeErrorCode" TEXT;

ALTER TABLE "Application"
  ADD CONSTRAINT "Application_intakeVersion_positive" CHECK ("intakeVersion" > 0);

CREATE INDEX "Application_automationState_updatedAt_idx"
  ON "Application"("automationState", "updatedAt");

CREATE TABLE "ApplicationDocument" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "storedPath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApplicationDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApplicationDocument_positive_size" CHECK ("sizeBytes" > 0),
  CONSTRAINT "ApplicationDocument_sha256" CHECK ("contentHash" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "ApplicationDocument_applicationId_type_idx"
  ON "ApplicationDocument"("applicationId", "type");
CREATE INDEX "ApplicationDocument_uploadedByUserId_createdAt_idx"
  ON "ApplicationDocument"("uploadedByUserId", "createdAt");

ALTER TABLE "ApplicationDocument"
  ADD CONSTRAINT "ApplicationDocument_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
