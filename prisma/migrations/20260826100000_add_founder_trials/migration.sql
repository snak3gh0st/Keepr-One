CREATE TYPE "FounderAccountType" AS ENUM ('AGENT', 'AGENCY');

CREATE TABLE "FounderEnrollment" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "agencyId" TEXT,
  "accountType" "FounderAccountType" NOT NULL,
  "phone" TEXT NOT NULL,
  "cohort" TEXT NOT NULL DEFAULT 'FOUNDERS_2026',
  "trialStartedAt" TIMESTAMP(3) NOT NULL,
  "trialEndsAt" TIMESTAMP(3) NOT NULL,
  "acceptedTermsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FounderEnrollment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FounderEnrollment_account_subject" CHECK (
    (
      "accountType" = 'AGENT'
      AND "agencyId" IS NULL
    )
    OR (
      "accountType" = 'AGENCY'
      AND "agencyId" IS NOT NULL
    )
  ),
  CONSTRAINT "FounderEnrollment_phone_not_blank" CHECK (
    btrim("phone") <> ''
  ),
  CONSTRAINT "FounderEnrollment_exact_trial_duration" CHECK (
    "trialEndsAt" = "trialStartedAt" + INTERVAL '2592000 seconds'
  )
);

CREATE UNIQUE INDEX "FounderEnrollment_agentId_key"
  ON "FounderEnrollment"("agentId");

CREATE UNIQUE INDEX "FounderEnrollment_agencyId_key"
  ON "FounderEnrollment"("agencyId");

CREATE INDEX "FounderEnrollment_trialEndsAt_idx"
  ON "FounderEnrollment"("trialEndsAt");

ALTER TABLE "FounderEnrollment"
  ADD CONSTRAINT "FounderEnrollment_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FounderEnrollment"
  ADD CONSTRAINT "FounderEnrollment_agencyId_fkey"
  FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
