-- The weekly recency window is a query over ("agentId", "phone") on
-- KBotFollowupJob. Keeping scheduled sends in the same table is what makes a
-- birthday message and a lapse warning cap each other; a separate table would
-- have let both fire on the same afternoon.
ALTER TABLE "KBotFollowupJob" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'FOLLOWUP';

CREATE INDEX "KBotFollowupJob_agentId_phone_idx" ON "KBotFollowupJob"("agentId", "phone");

-- Append-only. KBotContactPreference stays the mutable projection the send path
-- reads; this is the record of how the current state came to be.
CREATE TABLE "KBotContactConsentEvent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidence" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KBotContactConsentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KBotContactConsentEvent_agentId_subjectKey_occurredAt_idx"
    ON "KBotContactConsentEvent"("agentId", "subjectKey", "occurredAt");

ALTER TABLE "KBotContactConsentEvent" ADD CONSTRAINT "KBotContactConsentEvent_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No house default: a category with no template for the agent sends nothing.
CREATE TABLE "KBotMessageTemplate" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KBotMessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KBotMessageTemplate_agentId_category_language_key"
    ON "KBotMessageTemplate"("agentId", "category", "language");

ALTER TABLE "KBotMessageTemplate" ADD CONSTRAINT "KBotMessageTemplate_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
