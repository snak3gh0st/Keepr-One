CREATE TYPE "MessagingChannelProvider" AS ENUM ('EVOLUTION', 'META_CLOUD');
CREATE TYPE "MessagingChannelStatus" AS ENUM (
  'PROVISIONING',
  'WAITING_FOR_USER',
  'CONNECTED',
  'DEGRADED',
  'DISCONNECTED',
  'FAILED'
);

CREATE TABLE "AgentMessagingChannel" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "provider" "MessagingChannelProvider" NOT NULL,
  "status" "MessagingChannelStatus" NOT NULL DEFAULT 'PROVISIONING',
  "normalizedPhoneE164" TEXT,
  "externalPhoneNumberId" TEXT,
  "externalWabaId" TEXT,
  "externalInboxId" TEXT,
  "evolutionInstanceName" TEXT,
  "verifiedAt" TIMESTAMPTZ(3),
  "lastInboundAt" TIMESTAMPTZ(3),
  "lastOutboundAt" TIMESTAMPTZ(3),
  "lastHealthCheckAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AgentMessagingChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentMessagingChannel_agentId_key"
  ON "AgentMessagingChannel"("agentId");
CREATE UNIQUE INDEX "AgentMessagingChannel_normalizedPhoneE164_key"
  ON "AgentMessagingChannel"("normalizedPhoneE164");
CREATE UNIQUE INDEX "AgentMessagingChannel_externalPhoneNumberId_key"
  ON "AgentMessagingChannel"("externalPhoneNumberId");
CREATE UNIQUE INDEX "AgentMessagingChannel_externalInboxId_key"
  ON "AgentMessagingChannel"("externalInboxId");
CREATE UNIQUE INDEX "AgentMessagingChannel_evolutionInstanceName_key"
  ON "AgentMessagingChannel"("evolutionInstanceName");
CREATE INDEX "AgentMessagingChannel_provider_status_idx"
  ON "AgentMessagingChannel"("provider", "status");

ALTER TABLE "AgentMessagingChannel"
  ADD CONSTRAINT "AgentMessagingChannel_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
