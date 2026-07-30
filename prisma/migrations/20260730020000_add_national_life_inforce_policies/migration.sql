-- Raw landing zone for the National Life inforce book grid (policy/client data).
CREATE TABLE "NationalLifeInforcePolicy" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deploymentScope" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "nbPolicyNumber" TEXT,
    "policyStatus" TEXT,
    "policyIssueDate" TEXT,
    "lastStatusChangeDate" TEXT,
    "productClass" TEXT,
    "productName" TEXT,
    "productCode" TEXT,
    "companyCode" TEXT,
    "systemCode" TEXT,
    "planCode" TEXT,
    "agentNumber" TEXT,
    "agentName" TEXT,
    "servicingAgentName" TEXT,
    "servicingAgencyName" TEXT,
    "insuredClientName" TEXT,
    "insuredDob" TEXT,
    "insuredEmail" TEXT,
    "insuredPhoneNumber" TEXT,
    "ownerClientName" TEXT,
    "ownerDob" TEXT,
    "ownerEmail" TEXT,
    "ownerPhoneNumber" TEXT,
    "accumulatedCashValue" TEXT,
    "anticipatedAnnualPremium" TEXT,
    "termConversionDate" TEXT,
    "levelPeriodEndDate" TEXT,
    "employerName" TEXT,
    "raw" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeInforcePolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifeInforcePolicy_agentId_deploymentScope_policyNu_key"
    ON "NationalLifeInforcePolicy"("agentId", "deploymentScope", "policyNumber");

CREATE INDEX "NationalLifeInforcePolicy_agentId_idx"
    ON "NationalLifeInforcePolicy"("agentId");

CREATE INDEX "NationalLifeInforcePolicy_fetchedAt_idx"
    ON "NationalLifeInforcePolicy"("fetchedAt");

ALTER TABLE "NationalLifeInforcePolicy"
    ADD CONSTRAINT "NationalLifeInforcePolicy_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
