CREATE TYPE "PlatformModule" AS ENUM (
  'TODAY',
  'CALENDAR',
  'CRM',
  'MESSAGES',
  'POLICIES',
  'ILLUSTRATIONS',
  'COMMISSIONS',
  'JOURNEY',
  'AGENCY',
  'TEAM',
  'INTEGRATIONS'
);

CREATE TABLE "AdminProvisionedAccess" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "platformSubscriptionId" TEXT NOT NULL,
  "modules" "PlatformModule"[] NOT NULL DEFAULT ARRAY[]::"PlatformModule"[],
  "paymentRequiredAt" TIMESTAMP(3),
  "paymentReason" TEXT,
  "provisionedById" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdminProvisionedAccess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminProvisionedAccess_payment_requirement" CHECK (
    (
      "paymentRequiredAt" IS NULL
      AND "paymentReason" IS NULL
    )
    OR (
      "paymentRequiredAt" IS NOT NULL
      AND "paymentReason" IS NOT NULL
      AND btrim("paymentReason") <> ''
      AND char_length("paymentReason") <= 240
    )
  )
);

CREATE UNIQUE INDEX "AdminProvisionedAccess_agentId_key"
  ON "AdminProvisionedAccess"("agentId");

CREATE UNIQUE INDEX "AdminProvisionedAccess_platformSubscriptionId_key"
  ON "AdminProvisionedAccess"("platformSubscriptionId");

CREATE INDEX "AdminProvisionedAccess_paymentRequiredAt_idx"
  ON "AdminProvisionedAccess"("paymentRequiredAt");

CREATE INDEX "AdminProvisionedAccess_provisionedById_createdAt_idx"
  ON "AdminProvisionedAccess"("provisionedById", "createdAt");

CREATE INDEX "AdminProvisionedAccess_updatedById_idx"
  ON "AdminProvisionedAccess"("updatedById");

ALTER TABLE "AdminProvisionedAccess"
  ADD CONSTRAINT "AdminProvisionedAccess_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminProvisionedAccess"
  ADD CONSTRAINT "AdminProvisionedAccess_platformSubscriptionId_fkey"
  FOREIGN KEY ("platformSubscriptionId") REFERENCES "PlatformSubscription"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminProvisionedAccess"
  ADD CONSTRAINT "AdminProvisionedAccess_provisionedById_fkey"
  FOREIGN KEY ("provisionedById") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminProvisionedAccess"
  ADD CONSTRAINT "AdminProvisionedAccess_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
