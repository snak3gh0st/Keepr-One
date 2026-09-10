-- Additive migration: preserve the original founders table and every lead.
CREATE TYPE "MarketingLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST');
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');
CREATE TYPE "MarketingCampaignChannel" AS ENUM ('ORGANIC', 'META_ADS', 'GOOGLE_ADS', 'EMAIL', 'WHATSAPP', 'OTHER');

CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channel" "MarketingCampaignChannel" NOT NULL DEFAULT 'ORGANIC',
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "budgetCents" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketingCampaign_slug_key" ON "MarketingCampaign"("slug");
CREATE INDEX "MarketingCampaign_status_createdAt_idx" ON "MarketingCampaign"("status", "createdAt");

-- This is the real existing acquisition program, not a demonstration record.
INSERT INTO "MarketingCampaign" ("id", "slug", "name", "description", "channel", "status", "updatedAt")
VALUES ('founders-program', 'founders', 'Programa Founders', 'Cadastros recebidos pela página /founders.', 'ORGANIC', 'ACTIVE', CURRENT_TIMESTAMP);

-- Defaults attach both historical leads and writes from the previous app version.
ALTER TABLE "FounderLead"
    ADD COLUMN "status" "MarketingLeadStatus" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "campaignId" TEXT NOT NULL DEFAULT 'founders-program',
    ADD COLUMN "source" TEXT NOT NULL DEFAULT 'FOUNDERS',
    ADD COLUMN "ownerId" TEXT,
    ADD COLUMN "nextContactAt" TIMESTAMP(3),
    ADD COLUMN "utmSource" TEXT,
    ADD COLUMN "utmMedium" TEXT,
    ADD COLUMN "utmCampaign" TEXT,
    ADD COLUMN "utmContent" TEXT,
    ADD COLUMN "utmTerm" TEXT;
CREATE INDEX "FounderLead_createdAt_id_idx" ON "FounderLead"("createdAt", "id");
CREATE INDEX "FounderLead_status_createdAt_idx" ON "FounderLead"("status", "createdAt");
CREATE INDEX "FounderLead_campaignId_createdAt_idx" ON "FounderLead"("campaignId", "createdAt");
CREATE INDEX "FounderLead_ownerId_nextContactAt_idx" ON "FounderLead"("ownerId", "nextContactAt");
ALTER TABLE "FounderLead" ADD CONSTRAINT "FounderLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FounderLead" ADD CONSTRAINT "FounderLead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MarketingLeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingLeadNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketingLeadNote_leadId_createdAt_idx" ON "MarketingLeadNote"("leadId", "createdAt");
CREATE INDEX "MarketingLeadNote_authorId_idx" ON "MarketingLeadNote"("authorId");
ALTER TABLE "MarketingLeadNote" ADD CONSTRAINT "MarketingLeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "FounderLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingLeadNote" ADD CONSTRAINT "MarketingLeadNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
