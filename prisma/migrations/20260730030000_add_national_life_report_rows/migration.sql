-- Generic landing zone for National Life report grids (commissions, payments).
CREATE TABLE "NationalLifeReportRow" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deploymentScope" TEXT NOT NULL,
    "gridKey" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "primaryDate" TEXT,
    "label" TEXT,
    "amounts" JSONB NOT NULL,
    "raw" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeReportRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifeReportRow_agentId_deploymentScope_gridKey_rowK_key"
    ON "NationalLifeReportRow"("agentId", "deploymentScope", "gridKey", "rowKey");

CREATE INDEX "NationalLifeReportRow_agentId_gridKey_idx"
    ON "NationalLifeReportRow"("agentId", "gridKey");

CREATE INDEX "NationalLifeReportRow_fetchedAt_idx"
    ON "NationalLifeReportRow"("fetchedAt");

ALTER TABLE "NationalLifeReportRow"
    ADD CONSTRAINT "NationalLifeReportRow_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
