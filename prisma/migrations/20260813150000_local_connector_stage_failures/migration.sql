CREATE TABLE "NationalLifeConnectorStageFailure" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "gridKey" TEXT NOT NULL,
    "safeErrorCode" TEXT NOT NULL,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeConnectorStageFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifeConnectorStageFailure_deviceId_runId_gridKey_key"
ON "NationalLifeConnectorStageFailure"("deviceId", "runId", "gridKey");

CREATE INDEX "NationalLifeConnectorStageFailure_runId_resolvedAt_idx"
ON "NationalLifeConnectorStageFailure"("runId", "resolvedAt");

ALTER TABLE "NationalLifeConnectorStageFailure"
ADD CONSTRAINT "NationalLifeConnectorStageFailure_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "NationalLifeConnectorDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalLifeConnectorStageFailure"
ADD CONSTRAINT "NationalLifeConnectorStageFailure_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "NationalLifeSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
