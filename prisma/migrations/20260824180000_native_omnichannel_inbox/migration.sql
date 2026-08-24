ALTER TYPE "MessagingChannelProvider" ADD VALUE IF NOT EXISTS 'CHATWOOT_EMAIL';
ALTER TYPE "MessagingChannelProvider" ADD VALUE IF NOT EXISTS 'OTHER';

CREATE TYPE "MessagingChannelKind" AS ENUM (
  'WHATSAPP',
  'EMAIL',
  'SMS',
  'INSTAGRAM',
  'OTHER'
);

ALTER TABLE "AgentMessagingChannel"
  ADD COLUMN "kind" "MessagingChannelKind" NOT NULL DEFAULT 'WHATSAPP';

ALTER TABLE "AgentMessagingChannel"
  ALTER COLUMN "kind" DROP DEFAULT;

DROP INDEX "AgentMessagingChannel_agentId_key";

CREATE UNIQUE INDEX "AgentMessagingChannel_agentId_kind_key"
  ON "AgentMessagingChannel"("agentId", "kind");
