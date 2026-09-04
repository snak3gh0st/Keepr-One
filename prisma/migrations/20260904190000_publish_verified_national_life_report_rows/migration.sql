-- The landing table is intentionally left unchanged. Rows already present do
-- not contain enough run/page evidence to prove that their carrier snapshot
-- completed, and older connector binaries may still write it during rollout.
-- This separate projection is populated only by the new completion transaction.

CREATE TABLE "NationalLifeReportPublication" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deploymentScope" TEXT NOT NULL,
  "gridKey" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "stageCompletionId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NationalLifeReportPublication_pkey" PRIMARY KEY ("id")
);

-- This row is a transaction-scoped publication lock for each account/grid.
-- Its unique stage completion also makes repeated completion idempotent.
CREATE UNIQUE INDEX "NationalLifeReportPublication_agentId_deploymentScope_gridK_key"
  ON "NationalLifeReportPublication"("agentId", "deploymentScope", "gridKey");
CREATE UNIQUE INDEX "NationalLifeReportPublication_stageCompletionId_key"
  ON "NationalLifeReportPublication"("stageCompletionId");
CREATE INDEX "NationalLifeReportPublication_runId_gridKey_idx"
  ON "NationalLifeReportPublication"("runId", "gridKey");

ALTER TABLE "NationalLifeReportPublication"
  ADD CONSTRAINT "NationalLifeReportPublication_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NationalLifePublishedReportRow" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deploymentScope" TEXT NOT NULL,
  "gridKey" TEXT NOT NULL,
  "rowKey" TEXT NOT NULL,
  "primaryDate" TEXT,
  "label" TEXT,
  "amounts" JSONB NOT NULL,
  "raw" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "stageCompletionId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NationalLifePublishedReportRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifePublishedReportRow_agentId_deploymentScope_grid_key"
  ON "NationalLifePublishedReportRow"("agentId", "deploymentScope", "gridKey", "rowKey");
CREATE INDEX "NationalLifePublishedReportRow_agentId_gridKey_idx"
  ON "NationalLifePublishedReportRow"("agentId", "gridKey");
CREATE INDEX "NationalLifePublishedReportRow_stageCompletionId_idx"
  ON "NationalLifePublishedReportRow"("stageCompletionId");
CREATE INDEX "NationalLifePublishedReportRow_runId_gridKey_idx"
  ON "NationalLifePublishedReportRow"("runId", "gridKey");

ALTER TABLE "NationalLifePublishedReportRow"
  ADD CONSTRAINT "NationalLifePublishedReportRow_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Correspondence is a report grid too. Keep existing transfers attached to
-- their old landing rows, while new transfers use the verified projection so
-- a late old-client page cannot alter a document handle shown to the agent.
ALTER TABLE "NationalLifeDocumentTransfer"
  DROP CONSTRAINT IF EXISTS "NationalLifeDocumentTransfer_reportRowId_fkey";
ALTER TABLE "NationalLifeDocumentTransfer"
  ALTER COLUMN "reportRowId" DROP NOT NULL,
  ADD COLUMN "publishedReportRowId" TEXT;
ALTER TABLE "NationalLifeDocumentTransfer"
  ADD CONSTRAINT "NationalLifeDocumentTransfer_reportRowId_fkey"
  FOREIGN KEY ("reportRowId") REFERENCES "NationalLifeReportRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalLifeDocumentTransfer"
  ADD CONSTRAINT "NationalLifeDocumentTransfer_publishedReportRowId_fkey"
  FOREIGN KEY ("publishedReportRowId") REFERENCES "NationalLifePublishedReportRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalLifeDocumentTransfer"
  ADD CONSTRAINT "NationalLifeDocumentTransfer_exactly_one_source"
  CHECK (num_nonnulls("reportRowId", "publishedReportRowId") = 1);
CREATE UNIQUE INDEX "NationalLifeDocumentTransfer_agentId_publishedReportRowId_key"
  ON "NationalLifeDocumentTransfer"("agentId", "publishedReportRowId");

ALTER TABLE "PolicyDocument"
  ADD COLUMN "publishedSourceRowId" TEXT;
CREATE UNIQUE INDEX "PolicyDocument_publishedSourceRowId_key"
  ON "PolicyDocument"("publishedSourceRowId");
ALTER TABLE "PolicyDocument"
  ADD CONSTRAINT "PolicyDocument_publishedSourceRowId_fkey"
  FOREIGN KEY ("publishedSourceRowId") REFERENCES "NationalLifePublishedReportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
