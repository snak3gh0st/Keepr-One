-- Carrier-fetched documents are system artifacts, not manual user uploads.
ALTER TABLE "PolicyDocument"
  ALTER COLUMN "uploadedById" DROP NOT NULL,
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "sourceRowId" TEXT,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "fetchedAt" TIMESTAMP(3);

CREATE TABLE "NationalLifeDocumentTransfer" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "reportRowId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "documentId" TEXT,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT,
  "expectedBytes" INTEGER,
  "expectedSha256" TEXT,
  "totalChunks" INTEGER,
  "state" TEXT NOT NULL DEFAULT 'REQUESTED',
  "receivedBytes" INTEGER NOT NULL DEFAULT 0,
  "receivedChunks" INTEGER NOT NULL DEFAULT 0,
  "safeErrorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NationalLifeDocumentTransfer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NationalLifeDocumentChunk" (
  "id" TEXT NOT NULL,
  "transferId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "byteOffset" INTEGER NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NationalLifeDocumentChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PolicyDocument_sourceRowId_key" ON "PolicyDocument"("sourceRowId");
CREATE UNIQUE INDEX "PolicyDocument_provider_externalId_key" ON "PolicyDocument"("provider", "externalId");
CREATE UNIQUE INDEX "NationalLifeDocumentTransfer_documentId_key" ON "NationalLifeDocumentTransfer"("documentId");
CREATE UNIQUE INDEX "NationalLifeDocumentTransfer_agentId_reportRowId_key" ON "NationalLifeDocumentTransfer"("agentId", "reportRowId");
CREATE INDEX "NationalLifeDocumentTransfer_deviceId_state_idx" ON "NationalLifeDocumentTransfer"("deviceId", "state");
CREATE INDEX "NationalLifeDocumentTransfer_state_updatedAt_idx" ON "NationalLifeDocumentTransfer"("state", "updatedAt");
CREATE UNIQUE INDEX "NationalLifeDocumentChunk_transferId_sequence_key" ON "NationalLifeDocumentChunk"("transferId", "sequence");
CREATE INDEX "NationalLifeDocumentChunk_transferId_byteOffset_idx" ON "NationalLifeDocumentChunk"("transferId", "byteOffset");

ALTER TABLE "PolicyDocument"
  ADD CONSTRAINT "PolicyDocument_sourceRowId_fkey"
  FOREIGN KEY ("sourceRowId") REFERENCES "NationalLifeReportRow"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NationalLifeDocumentTransfer"
  ADD CONSTRAINT "NationalLifeDocumentTransfer_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NationalLifeDocumentTransfer_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "NationalLifeConnectorDevice"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NationalLifeDocumentTransfer_reportRowId_fkey"
  FOREIGN KEY ("reportRowId") REFERENCES "NationalLifeReportRow"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NationalLifeDocumentTransfer_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "Policy"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NationalLifeDocumentTransfer_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "PolicyDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NationalLifeDocumentChunk"
  ADD CONSTRAINT "NationalLifeDocumentChunk_transferId_fkey"
  FOREIGN KEY ("transferId") REFERENCES "NationalLifeDocumentTransfer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
