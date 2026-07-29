-- AlterEnum
ALTER TYPE "BrowserJobState" ADD VALUE 'ACTION_REQUIRED';

-- CreateTable
CREATE TABLE "AgentIntegrationSession" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "keyVersion" TEXT,
    "algorithm" TEXT,
    "iv" TEXT,
    "ciphertext" TEXT,
    "authTag" TEXT,
    "carrierExpiresAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentIntegrationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NationalLifeConnectionAttempt" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "runtimeKeyVersion" TEXT,
    "runtimeAlgorithm" TEXT,
    "runtimeIv" TEXT,
    "runtimeCiphertext" TEXT,
    "runtimeAuthTag" TEXT,
    "viewerNonceHash" TEXT,
    "currentOrigin" TEXT,
    "safeErrorCode" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeConnectionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentIntegrationSession_provider_status_idx" ON "AgentIntegrationSession"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentIntegrationSession_agentId_provider_key" ON "AgentIntegrationSession"("agentId", "provider");

-- CreateIndex
CREATE INDEX "NationalLifeConnectionAttempt_state_expiresAt_idx" ON "NationalLifeConnectionAttempt"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "NationalLifeConnectionAttempt_leaseExpiresAt_idx" ON "NationalLifeConnectionAttempt"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "NationalLifeConnectionAttempt_agentId_provider_key" ON "NationalLifeConnectionAttempt"("agentId", "provider");

-- AddForeignKey
ALTER TABLE "AgentIntegrationSession" ADD CONSTRAINT "AgentIntegrationSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NationalLifeConnectionAttempt" ADD CONSTRAINT "NationalLifeConnectionAttempt_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
