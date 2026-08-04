ALTER TABLE "NationalLifeSyncRun"
  ADD COLUMN "connectorDeviceId" TEXT,
  ADD COLUMN "executionSource" TEXT NOT NULL DEFAULT 'REMOTE';

CREATE TABLE "NationalLifeConnectorPairing" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NationalLifeConnectorPairing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NationalLifeConnectorDevice" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "publicKeyJwk" JSONB NOT NULL,
  "publicKeyThumbprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NationalLifeConnectorDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NationalLifeConnectorReplay" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NationalLifeConnectorReplay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NationalLifeConnectorStageReceipt" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "gridKey" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "truncated" BOOLEAN NOT NULL DEFAULT true,
  "contentHash" TEXT NOT NULL,
  "recordCount" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NationalLifeConnectorStageReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifeConnectorPairing_codeHash_key"
  ON "NationalLifeConnectorPairing"("codeHash");
CREATE INDEX "NationalLifeConnectorPairing_agentId_expiresAt_idx"
  ON "NationalLifeConnectorPairing"("agentId", "expiresAt");

CREATE UNIQUE INDEX "NationalLifeConnectorDevice_publicKeyThumbprint_key"
  ON "NationalLifeConnectorDevice"("publicKeyThumbprint");
CREATE INDEX "NationalLifeConnectorDevice_agentId_status_idx"
  ON "NationalLifeConnectorDevice"("agentId", "status");

CREATE UNIQUE INDEX "NationalLifeConnectorReplay_deviceId_jti_key"
  ON "NationalLifeConnectorReplay"("deviceId", "jti");
CREATE INDEX "NationalLifeConnectorReplay_expiresAt_idx"
  ON "NationalLifeConnectorReplay"("expiresAt");

CREATE UNIQUE INDEX "NationalLifeConnectorStageReceipt_idempotencyKey_key"
  ON "NationalLifeConnectorStageReceipt"("idempotencyKey");
CREATE UNIQUE INDEX "NationalLifeConnectorStageReceipt_deviceId_runId_gridKey_sequence_key"
  ON "NationalLifeConnectorStageReceipt"("deviceId", "runId", "gridKey", "sequence");
CREATE INDEX "NationalLifeConnectorStageReceipt_runId_gridKey_idx"
  ON "NationalLifeConnectorStageReceipt"("runId", "gridKey");
CREATE INDEX "NationalLifeConnectorStageReceipt_runId_truncated_idx"
  ON "NationalLifeConnectorStageReceipt"("runId", "truncated");

CREATE INDEX "NationalLifeSyncRun_connectorDeviceId_createdAt_idx"
  ON "NationalLifeSyncRun"("connectorDeviceId", "createdAt");

ALTER TABLE "NationalLifeConnectorPairing"
  ADD CONSTRAINT "NationalLifeConnectorPairing_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalLifeConnectorDevice"
  ADD CONSTRAINT "NationalLifeConnectorDevice_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalLifeConnectorReplay"
  ADD CONSTRAINT "NationalLifeConnectorReplay_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "NationalLifeConnectorDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalLifeConnectorStageReceipt"
  ADD CONSTRAINT "NationalLifeConnectorStageReceipt_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "NationalLifeConnectorDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalLifeConnectorStageReceipt"
  ADD CONSTRAINT "NationalLifeConnectorStageReceipt_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "NationalLifeSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalLifeSyncRun"
  ADD CONSTRAINT "NationalLifeSyncRun_connectorDeviceId_fkey"
  FOREIGN KEY ("connectorDeviceId") REFERENCES "NationalLifeConnectorDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
