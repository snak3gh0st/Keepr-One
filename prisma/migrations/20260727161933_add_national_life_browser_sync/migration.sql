-- CreateEnum
CREATE TYPE "BrowserJobState" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_FOR_MFA', 'WAITING_FOR_REVIEW', 'RETRYABLE', 'CREDENTIALS_EXPIRED', 'MANUAL_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BrowserJobOperation" AS ENUM ('TEST_CONNECTION', 'SYNC_CASE_READ');

-- CreateTable
CREATE TABLE "AgentIntegrationCredential" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "maskedUsername" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNTESTED',
    "lastTestedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentIntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowserAutomationJob" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "caseId" TEXT,
    "provider" TEXT NOT NULL,
    "operation" "BrowserJobOperation" NOT NULL,
    "state" "BrowserJobState" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "safeErrorCode" TEXT,
    "safeErrorDetail" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "continuationKeyVersion" TEXT,
    "continuationIv" TEXT,
    "continuationCiphertext" TEXT,
    "continuationAuthTag" TEXT,
    "continuationExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserAutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentIntegrationCredential_provider_status_idx" ON "AgentIntegrationCredential"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentIntegrationCredential_agentId_provider_key" ON "AgentIntegrationCredential"("agentId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserAutomationJob_idempotencyKey_key" ON "BrowserAutomationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BrowserAutomationJob_state_availableAt_idx" ON "BrowserAutomationJob"("state", "availableAt");

-- CreateIndex
CREATE INDEX "BrowserAutomationJob_agentId_createdAt_idx" ON "BrowserAutomationJob"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "BrowserAutomationJob_caseId_createdAt_idx" ON "BrowserAutomationJob"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentIntegrationCredential" ADD CONSTRAINT "AgentIntegrationCredential_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserAutomationJob" ADD CONSTRAINT "BrowserAutomationJob_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserAutomationJob" ADD CONSTRAINT "BrowserAutomationJob_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "InsuranceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
