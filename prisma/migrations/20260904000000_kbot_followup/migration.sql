-- AlterEnum
ALTER TYPE "PlatformAddon" ADD VALUE 'K_BOT_FOLLOWUP';

-- AlterTable
ALTER TABLE "PlatformAddonSubscription" ADD COLUMN     "checkoutExpiresAt" TIMESTAMP(3),
ADD COLUMN     "stripeCheckoutSessionId" TEXT;

-- CreateTable
CREATE TABLE "KBotCreditGrant" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "allowance" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "spent" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KBotCreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KBotFollowupJob" (
    "billedTokens" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceHref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "grantId" TEXT,
    "reservedTokens" INTEGER NOT NULL DEFAULT 192,
    "creditState" TEXT NOT NULL DEFAULT 'RESERVED',
    "conversationId" TEXT,
    "senderIdentity" TEXT,
    "messageId" TEXT,
    "providerMessageId" TEXT,
    "content" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "generationStartedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KBotFollowupJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KBotContactPreference" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "snoozedUntil" TIMESTAMP(3),
    "lastManualAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KBotContactPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KBotCreditAllocation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "reservedTokens" INTEGER NOT NULL,
    "spentTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KBotCreditAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KBotCreditGrant_sourceKey_key" ON "KBotCreditGrant"("sourceKey");

-- CreateIndex
CREATE INDEX "KBotCreditGrant_agentId_expiresAt_idx" ON "KBotCreditGrant"("agentId", "expiresAt");

-- CreateIndex
CREATE INDEX "KBotFollowupJob_status_updatedAt_idx" ON "KBotFollowupJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "KBotFollowupJob_agentId_phone_createdAt_idx" ON "KBotFollowupJob"("agentId", "phone", "createdAt");

-- CreateIndex
CREATE INDEX "KBotFollowupJob_batchId_idx" ON "KBotFollowupJob"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "KBotFollowupJob_agentId_requestKey_candidateId_key" ON "KBotFollowupJob"("agentId", "requestKey", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "KBotContactPreference_agentId_subjectKey_key" ON "KBotContactPreference"("agentId", "subjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "KBotCreditAllocation_jobId_grantId_key" ON "KBotCreditAllocation"("jobId", "grantId");

-- AddForeignKey
ALTER TABLE "KBotCreditGrant" ADD CONSTRAINT "KBotCreditGrant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KBotFollowupJob" ADD CONSTRAINT "KBotFollowupJob_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KBotFollowupJob" ADD CONSTRAINT "KBotFollowupJob_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "KBotCreditGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KBotContactPreference" ADD CONSTRAINT "KBotContactPreference_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KBotCreditAllocation" ADD CONSTRAINT "KBotCreditAllocation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "KBotFollowupJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KBotCreditAllocation" ADD CONSTRAINT "KBotCreditAllocation_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "KBotCreditGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "KBotCreditGrant" ADD CONSTRAINT "KBotCreditGrant_balance_check"
CHECK ("allowance" >= 0 AND "reserved" >= 0 AND "spent" >= 0 AND "reserved" + "spent" <= "allowance");
ALTER TABLE "KBotFollowupJob" ADD CONSTRAINT "KBotFollowupJob_tokens_check"
CHECK ("reservedTokens" >= 0 AND "inputTokens" >= 0 AND "outputTokens" >= 0 AND "billedTokens" >= 0 AND "billedTokens" <= "reservedTokens");
ALTER TABLE "KBotCreditAllocation" ADD CONSTRAINT "KBotCreditAllocation_tokens_check"
CHECK ("reservedTokens" > 0 AND "spentTokens" >= 0 AND "spentTokens" <= "reservedTokens");
