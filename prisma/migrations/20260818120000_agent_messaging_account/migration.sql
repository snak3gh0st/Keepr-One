CREATE TABLE "AgentMessagingAccount" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'CHATWOOT',
  "externalAccountId" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentMessagingAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentMessagingAccount_agentId_key" ON "AgentMessagingAccount"("agentId");
CREATE UNIQUE INDEX "AgentMessagingAccount_provider_externalAccountId_key"
  ON "AgentMessagingAccount"("provider", "externalAccountId");

ALTER TABLE "AgentMessagingAccount" ADD CONSTRAINT "AgentMessagingAccount_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
