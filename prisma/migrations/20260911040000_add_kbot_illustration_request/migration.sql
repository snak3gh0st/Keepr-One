-- An illustration raised by the K-Bot waits here until the agent has read the
-- numbers. `status` is text, like the other K-Bot tables, so a new state does
-- not need an enum migration on a hot table.
-- CreateTable
CREATE TABLE "KBotIllustrationRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "signal" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "illustrationId" TEXT,
    "commandId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "safeErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KBotIllustrationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KBotIllustrationRequest_illustrationId_key" ON "KBotIllustrationRequest"("illustrationId");

-- CreateIndex
CREATE INDEX "KBotIllustrationRequest_agentId_status_idx" ON "KBotIllustrationRequest"("agentId", "status");

-- CreateIndex
CREATE INDEX "KBotIllustrationRequest_agentId_clientId_productKey_status_idx" ON "KBotIllustrationRequest"("agentId", "clientId", "productKey", "status");

-- CreateIndex
CREATE INDEX "KBotIllustrationRequest_status_createdAt_idx" ON "KBotIllustrationRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "KBotIllustrationRequest" ADD CONSTRAINT "KBotIllustrationRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KBotIllustrationRequest" ADD CONSTRAINT "KBotIllustrationRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KBotIllustrationRequest" ADD CONSTRAINT "KBotIllustrationRequest_illustrationId_fkey" FOREIGN KEY ("illustrationId") REFERENCES "Illustration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
