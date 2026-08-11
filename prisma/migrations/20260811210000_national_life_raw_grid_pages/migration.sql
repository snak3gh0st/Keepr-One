CREATE TABLE "NationalLifeRawGridPage" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deploymentScope" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "gridKey" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "records" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeRawGridPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifeRawGridPage_runId_gridKey_sequence_key"
ON "NationalLifeRawGridPage"("runId", "gridKey", "sequence");

CREATE INDEX "NationalLifeRawGridPage_agentId_deploymentScope_gridKey_idx"
ON "NationalLifeRawGridPage"("agentId", "deploymentScope", "gridKey");

CREATE INDEX "NationalLifeRawGridPage_runId_gridKey_idx"
ON "NationalLifeRawGridPage"("runId", "gridKey");

ALTER TABLE "NationalLifeRawGridPage"
ADD CONSTRAINT "NationalLifeRawGridPage_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalLifeRawGridPage"
ADD CONSTRAINT "NationalLifeRawGridPage_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "NationalLifeSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
