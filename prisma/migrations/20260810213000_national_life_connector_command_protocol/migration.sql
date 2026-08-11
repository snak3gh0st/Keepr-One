CREATE TYPE "NationalLifeConnectorCommandState" AS ENUM (
  'QUEUED', 'RUNNING', 'AUTH_REQUIRED', 'WAITING_FOR_CONFIRMATION',
  'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'
);

CREATE TYPE "NationalLifeConnectorConfirmationState" AS ENUM (
  'NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'
);

CREATE TABLE "NationalLifeConnectorCommand" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deviceId" TEXT,
  "protocolVersion" INTEGER NOT NULL,
  "runId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "state" "NationalLifeConnectorCommandState" NOT NULL DEFAULT 'QUEUED',
  "target" JSONB,
  "params" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
  "confirmationState" "NationalLifeConnectorConfirmationState" NOT NULL DEFAULT 'NOT_REQUIRED',
  "safeErrorCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NationalLifeConnectorCommand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NationalLifeConnectorCommandEvent" (
  "id" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB,
  "safeErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NationalLifeConnectorCommandEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NationalLifeConnectorCommandConfirmation" (
  "id" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "state" "NationalLifeConnectorConfirmationState" NOT NULL DEFAULT 'PENDING',
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NationalLifeConnectorCommandConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifeConnectorCommand_agentId_idempotencyKey_key"
  ON "NationalLifeConnectorCommand"("agentId", "idempotencyKey");
CREATE INDEX "NationalLifeConnectorCommand_agentId_state_createdAt_idx"
  ON "NationalLifeConnectorCommand"("agentId", "state", "createdAt");
CREATE INDEX "NationalLifeConnectorCommand_deviceId_state_createdAt_idx"
  ON "NationalLifeConnectorCommand"("deviceId", "state", "createdAt");
CREATE INDEX "NationalLifeConnectorCommand_expiresAt_idx"
  ON "NationalLifeConnectorCommand"("expiresAt");
CREATE UNIQUE INDEX "NationalLifeConnectorCommandEvent_commandId_sequence_key"
  ON "NationalLifeConnectorCommandEvent"("commandId", "sequence");
CREATE INDEX "NationalLifeConnectorCommandEvent_commandId_createdAt_idx"
  ON "NationalLifeConnectorCommandEvent"("commandId", "createdAt");
CREATE UNIQUE INDEX "NationalLifeConnectorCommandConfirmation_commandId_key"
  ON "NationalLifeConnectorCommandConfirmation"("commandId");
CREATE INDEX "NationalLifeConnectorCommandConfirmation_state_expiresAt_idx"
  ON "NationalLifeConnectorCommandConfirmation"("state", "expiresAt");

ALTER TABLE "NationalLifeConnectorCommand"
  ADD CONSTRAINT "NationalLifeConnectorCommand_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalLifeConnectorCommand"
  ADD CONSTRAINT "NationalLifeConnectorCommand_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "NationalLifeConnectorDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NationalLifeConnectorCommandEvent"
  ADD CONSTRAINT "NationalLifeConnectorCommandEvent_commandId_fkey"
  FOREIGN KEY ("commandId") REFERENCES "NationalLifeConnectorCommand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalLifeConnectorCommandConfirmation"
  ADD CONSTRAINT "NationalLifeConnectorCommandConfirmation_commandId_fkey"
  FOREIGN KEY ("commandId") REFERENCES "NationalLifeConnectorCommand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
