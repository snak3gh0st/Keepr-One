-- Additive and backfill-free: an existing run has an empty array, which the
-- service reads as the legacy default pair (NEW_BUSINESS, INFORCE_CLIENTS) —
-- the only list a run could have planned before this column existed.
ALTER TABLE "NationalLifeSyncRun"
  ADD COLUMN "plannedGridKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Nullable on purpose: receipts written before this column cannot say how many
-- rows survived normalization, and NULL is honest about that where 0 would lie.
ALTER TABLE "NationalLifeConnectorStageReceipt"
  ADD COLUMN "writtenCount" INTEGER;
