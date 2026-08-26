ALTER TABLE "Policy"
  ADD COLUMN "faceAmountSource" TEXT,
  ADD COLUMN "carrierDetailUpdatedAt" TIMESTAMP(3);

CREATE TABLE "NationalLifePolicyDetailSnapshot" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deploymentScope" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "policyNumber" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "coverageCaptured" BOOLEAN NOT NULL DEFAULT false,
  "paymentsCaptured" BOOLEAN NOT NULL DEFAULT false,
  "totalFaceAmount" DECIMAL(18,2),
  "netDeathBenefit" DECIMAL(18,2),
  "nextScheduledPaymentDate" TIMESTAMP(3),
  "paymentFrequency" TEXT,
  "plannedPeriodicPayment" DECIMAL(18,2),
  "anticipatedAnnualPremium" DECIMAL(18,2),
  "minimumMonthlyPremium" DECIMAL(18,2),
  "minimumGuaranteedPremium" DECIMAL(18,2),
  "ctp" DECIMAL(18,2),
  "mecLimit" DECIMAL(18,2),
  "mecLimitThrough" TIMESTAMP(3),
  "guidelinePremiumLimit" DECIMAL(18,2),
  "guidelinePremiumLimitThrough" TIMESTAMP(3),
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NationalLifePolicyDetailSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifePolicyDetailSnapshot_policyId_key"
  ON "NationalLifePolicyDetailSnapshot"("policyId");

CREATE INDEX "NationalLifePolicyDetailSnapshot_agentId_deploymentScope_ob_idx"
  ON "NationalLifePolicyDetailSnapshot"("agentId", "deploymentScope", "observedAt");

CREATE INDEX "NationalLifePolicyDetailSnapshot_policyNumber_idx"
  ON "NationalLifePolicyDetailSnapshot"("policyNumber");

ALTER TABLE "NationalLifePolicyDetailSnapshot"
  ADD CONSTRAINT "NationalLifePolicyDetailSnapshot_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalLifePolicyDetailSnapshot"
  ADD CONSTRAINT "NationalLifePolicyDetailSnapshot_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
