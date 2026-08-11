CREATE TABLE "NationalLifeConnectorStageCompletion" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "gridKey" TEXT NOT NULL,
    "expectedRecordCount" INTEGER NOT NULL,
    "receivedRecordCount" INTEGER NOT NULL,
    "finalSequence" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NationalLifeConnectorStageCompletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifeConnectorStageCompletion_deviceId_runId_gridKey_key"
ON "NationalLifeConnectorStageCompletion"("deviceId", "runId", "gridKey");

CREATE INDEX "NationalLifeConnectorStageCompletion_runId_gridKey_idx"
ON "NationalLifeConnectorStageCompletion"("runId", "gridKey");

ALTER TABLE "NationalLifeConnectorStageCompletion"
ADD CONSTRAINT "NationalLifeConnectorStageCompletion_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "NationalLifeConnectorDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalLifeConnectorStageCompletion"
ADD CONSTRAINT "NationalLifeConnectorStageCompletion_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "NationalLifeSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
