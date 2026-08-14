ALTER TABLE "NationalLifeConnectorStageReceipt"
  ADD COLUMN "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rejectedCount" INTEGER NOT NULL DEFAULT 0;
