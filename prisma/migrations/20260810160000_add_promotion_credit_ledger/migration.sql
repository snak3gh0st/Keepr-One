-- Target Premium / CTP production is not commission income. Keep it in its own
-- append-only ledger so a promotion can always be reconstructed from carrier
-- events within the rolling recognition window.

-- CreateEnum
CREATE TYPE "PromotionCreditStatus" AS ENUM (
  'ESTIMATED',
  'PENDING_CARRIER',
  'CONFIRMED',
  'ADJUSTED',
  'REVERSED'
);

-- CreateEnum
CREATE TYPE "PromotionCreditAttributionKind" AS ENUM ('PERSONAL', 'AGENCY');

-- CreateEnum
CREATE TYPE "PromotionAccessScope" AS ENUM ('PERSONAL', 'AGENCY');

-- CreateEnum
CREATE TYPE "PromotionAchievementRoute" AS ENUM ('PERSONAL', 'AGENCY');

-- Journey plan access is explicit. Existing agents safely receive PERSONAL;
-- hierarchy shape is deliberately not used as a billing or entitlement proxy.
ALTER TABLE "Agent"
  ADD COLUMN "promotionAccessScope" "PromotionAccessScope" NOT NULL DEFAULT 'PERSONAL';

-- Add optional normalized carrier fields without rewriting existing snapshots.
ALTER TABLE "NationalLifeCaseSnapshot"
  ADD COLUMN "targetPremium" TEXT;

ALTER TABLE "NationalLifeInforcePolicy"
  ADD COLUMN "targetPremium" TEXT;

ALTER TABLE "Illustration"
  ADD COLUMN "targetPremium" DECIMAL(65,30),
  ADD COLUMN "targetPremiumSource" TEXT;

-- CreateTable
CREATE TABLE "PromotionCredit" (
  "id" TEXT NOT NULL,
  "carrier" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "policyNumber" TEXT,
  "producerAgentId" TEXT NOT NULL,
  "targetPremium" DECIMAL(65,30),
  "anticipatedAnnualPremium" DECIMAL(65,30),
  "qualificationWeight" DECIMAL(65,30),
  "creditedPc" DECIMAL(65,30) NOT NULL,
  "status" "PromotionCreditStatus" NOT NULL,
  "recognizedAt" TIMESTAMP(3) NOT NULL,
  "supersedesCreditId" TEXT,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PromotionCredit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PromotionCredit_nonnegative_inputs_check" CHECK (
    ("targetPremium" IS NULL OR "targetPremium" >= 0) AND
    ("anticipatedAnnualPremium" IS NULL OR "anticipatedAnnualPremium" >= 0) AND
    ("qualificationWeight" IS NULL OR "qualificationWeight" >= 0)
  ),
  CONSTRAINT "PromotionCredit_delta_sign_check" CHECK (
    ("status" IN ('ESTIMATED', 'PENDING_CARRIER', 'CONFIRMED') AND "creditedPc" >= 0) OR
    ("status" = 'ADJUSTED' AND "creditedPc" <> 0) OR
    ("status" = 'REVERSED' AND "creditedPc" < 0)
  ),
  CONSTRAINT "PromotionCredit_correction_link_check" CHECK (
    "status" NOT IN ('ADJUSTED', 'REVERSED') OR "supersedesCreditId" IS NOT NULL
  )
);

-- CreateTable
CREATE TABLE "PromotionCreditAttribution" (
  "id" TEXT NOT NULL,
  "promotionCreditId" TEXT NOT NULL,
  "kind" "PromotionCreditAttributionKind" NOT NULL,
  "agentId" TEXT NOT NULL,
  "leaderAgentId" TEXT,
  "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PromotionCreditAttribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PromotionCreditAttribution_leader_check" CHECK (
    ("kind" = 'PERSONAL' AND "leaderAgentId" IS NULL) OR
    ("kind" = 'AGENCY' AND "leaderAgentId" IS NOT NULL AND "leaderAgentId" <> "agentId")
  )
);

-- CreateTable
CREATE TABLE "PromotionAchievement" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "rankId" TEXT NOT NULL,
  "step" INTEGER NOT NULL,
  "route" "PromotionAchievementRoute" NOT NULL,
  "achievedAt" TIMESTAMP(3) NOT NULL,
  "qualifyingWindowStart" TIMESTAMP(3) NOT NULL,
  "qualifyingWindowEnd" TIMESTAMP(3) NOT NULL,
  "personalPc" DECIMAL(65,30) NOT NULL,
  "agencyPc" DECIMAL(65,30) NOT NULL,
  "ruleSetVersion" TEXT NOT NULL,
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PromotionAchievement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PromotionAchievement_nonnegative_pc_check" CHECK (
    "personalPc" >= 0 AND "agencyPc" >= 0
  ),
  CONSTRAINT "PromotionAchievement_window_check" CHECK (
    "qualifyingWindowEnd" >= "qualifyingWindowStart"
  )
);

-- Idempotency is carrier event identity, intentionally independent of agent.
CREATE UNIQUE INDEX "PromotionCredit_carrier_source_externalId_key"
  ON "PromotionCredit"("carrier", "source", "externalId");

CREATE INDEX "PromotionCredit_producerAgentId_recognizedAt_idx"
  ON "PromotionCredit"("producerAgentId", "recognizedAt");

CREATE INDEX "PromotionCredit_status_recognizedAt_idx"
  ON "PromotionCredit"("status", "recognizedAt");

CREATE INDEX "PromotionCredit_policyNumber_recognizedAt_idx"
  ON "PromotionCredit"("policyNumber", "recognizedAt");

CREATE INDEX "PromotionCredit_supersedesCreditId_idx"
  ON "PromotionCredit"("supersedesCreditId");

-- A credit has exactly one producer view and at most one frozen agency view per
-- eligible upline. Partial indexes are necessary because every PERSONAL row has
-- a null leader while one credit may legitimately have several AGENCY rows.
CREATE UNIQUE INDEX "PromotionCreditAttribution_personal_credit_key"
  ON "PromotionCreditAttribution"("promotionCreditId")
  WHERE "kind" = 'PERSONAL';

CREATE UNIQUE INDEX "PromotionCreditAttribution_agency_leader_key"
  ON "PromotionCreditAttribution"("promotionCreditId", "leaderAgentId")
  WHERE "kind" = 'AGENCY';

CREATE INDEX "PromotionCreditAttribution_promotionCreditId_kind_idx"
  ON "PromotionCreditAttribution"("promotionCreditId", "kind");

CREATE INDEX "PromotionCreditAttribution_agentId_kind_idx"
  ON "PromotionCreditAttribution"("agentId", "kind");

CREATE INDEX "PromotionCreditAttribution_leaderAgentId_kind_idx"
  ON "PromotionCreditAttribution"("leaderAgentId", "kind");

-- Only one active achievement exists for a rank, while invalidated historical
-- rows remain immutable evidence and do not prevent a later requalification.
CREATE UNIQUE INDEX "PromotionAchievement_active_agentId_rankId_key"
  ON "PromotionAchievement"("agentId", "rankId")
  WHERE "invalidatedAt" IS NULL;

CREATE INDEX "PromotionAchievement_agentId_rankId_idx"
  ON "PromotionAchievement"("agentId", "rankId");

CREATE INDEX "PromotionAchievement_agentId_step_idx"
  ON "PromotionAchievement"("agentId", "step");

-- AddForeignKey
ALTER TABLE "PromotionCredit"
  ADD CONSTRAINT "PromotionCredit_producerAgentId_fkey"
  FOREIGN KEY ("producerAgentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PromotionCredit"
  ADD CONSTRAINT "PromotionCredit_supersedesCreditId_fkey"
  FOREIGN KEY ("supersedesCreditId") REFERENCES "PromotionCredit"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PromotionCreditAttribution"
  ADD CONSTRAINT "PromotionCreditAttribution_promotionCreditId_fkey"
  FOREIGN KEY ("promotionCreditId") REFERENCES "PromotionCredit"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PromotionCreditAttribution"
  ADD CONSTRAINT "PromotionCreditAttribution_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PromotionCreditAttribution"
  ADD CONSTRAINT "PromotionCreditAttribution_leaderAgentId_fkey"
  FOREIGN KEY ("leaderAgentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PromotionAchievement"
  ADD CONSTRAINT "PromotionAchievement_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A frozen attribution must always name the producer recorded on its credit.
-- PostgreSQL constraint triggers can only be AFTER triggers, so this invariant
-- uses a BEFORE INSERT row trigger to reject invalid data before it is stored.
CREATE FUNCTION "enforce_promotion_attribution_producer"()
RETURNS TRIGGER AS $$
DECLARE
  expected_producer_id TEXT;
BEGIN
  SELECT "producerAgentId"
    INTO expected_producer_id
    FROM "PromotionCredit"
    WHERE "id" = NEW."promotionCreditId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion credit % does not exist', NEW."promotionCreditId"
      USING ERRCODE = '23503';
  END IF;

  IF NEW."agentId" <> expected_producer_id THEN
    RAISE EXCEPTION
      'promotion attribution agent % does not match credit producer %',
      NEW."agentId",
      expected_producer_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PromotionCreditAttribution_producer_guard"
  BEFORE INSERT ON "PromotionCreditAttribution"
  FOR EACH ROW EXECUTE FUNCTION "enforce_promotion_attribution_producer"();

-- Enforce append-only semantics at the database boundary. Corrections and
-- reversals are inserted as new PromotionCredit rows; frozen attributions are
-- never rewritten after a hierarchy change.
CREATE FUNCTION "prevent_promotion_ledger_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'promotion credit ledger is append-only'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PromotionCredit_immutable"
  BEFORE UPDATE OR DELETE ON "PromotionCredit"
  FOR EACH ROW EXECUTE FUNCTION "prevent_promotion_ledger_mutation"();

CREATE TRIGGER "PromotionCreditAttribution_immutable"
  BEFORE UPDATE OR DELETE ON "PromotionCreditAttribution"
  FOR EACH ROW EXECUTE FUNCTION "prevent_promotion_ledger_mutation"();
