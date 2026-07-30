-- Raw landing zone for National Life agent-portal grid rows.
CREATE TABLE "NationalLifeCaseSnapshot" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deploymentScope" TEXT NOT NULL,
    "gridKey" TEXT NOT NULL,
    "policyNo" TEXT NOT NULL,
    "insuredName" TEXT,
    "ownerName" TEXT,
    "product" TEXT,
    "carrierStatus" TEXT,
    "deliveryStatus" TEXT,
    "actionRequired" TEXT,
    "requirements" TEXT,
    "submitDate" TEXT,
    "sentDate" TEXT,
    "modalPremium" TEXT,
    "anticipatedAnnualPremium" TEXT,
    "submitMethod" TEXT,
    "caseManager" TEXT,
    "agency" TEXT,
    "writingAgentName" TEXT,
    "writingAgentNumber" TEXT,
    "companyCode" TEXT,
    "raw" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeCaseSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifeCaseSnapshot_agentId_deploymentScope_gridKey_pol_key"
    ON "NationalLifeCaseSnapshot"("agentId", "deploymentScope", "gridKey", "policyNo");

CREATE INDEX "NationalLifeCaseSnapshot_agentId_gridKey_idx"
    ON "NationalLifeCaseSnapshot"("agentId", "gridKey");

CREATE INDEX "NationalLifeCaseSnapshot_fetchedAt_idx"
    ON "NationalLifeCaseSnapshot"("fetchedAt");

ALTER TABLE "NationalLifeCaseSnapshot"
    ADD CONSTRAINT "NationalLifeCaseSnapshot_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
