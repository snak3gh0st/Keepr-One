ALTER TABLE "NationalLifeInforcePolicy"
  ADD COLUMN "insuredAddress" TEXT,
  ADD COLUMN "insuredAddressLine1" TEXT,
  ADD COLUMN "insuredAddressLine2" TEXT,
  ADD COLUMN "insuredCity" TEXT,
  ADD COLUMN "insuredState" TEXT,
  ADD COLUMN "insuredZipcode" TEXT,
  ADD COLUMN "ownerAddress" TEXT,
  ADD COLUMN "ownerAddressLine1" TEXT,
  ADD COLUMN "ownerAddressLine2" TEXT,
  ADD COLUMN "ownerCity" TEXT,
  ADD COLUMN "ownerState" TEXT,
  ADD COLUMN "ownerZipcode" TEXT;

CREATE TABLE "NationalLifeExportUpload" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "expectedBytes" INTEGER NOT NULL,
  "expectedSha256" TEXT NOT NULL,
  "totalChunks" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'UPLOADING',
  "receivedBytes" INTEGER NOT NULL DEFAULT 0,
  "receivedChunks" INTEGER NOT NULL DEFAULT 0,
  "rowCount" INTEGER,
  "writtenCount" INTEGER,
  "safeErrorCode" TEXT,
  "fileBytes" BYTEA,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NationalLifeExportUpload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NationalLifeExportChunk" (
  "id" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "byteOffset" INTEGER NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NationalLifeExportChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalLifeExportUpload_deviceId_runId_sourceKey_key" ON "NationalLifeExportUpload"("deviceId", "runId", "sourceKey");
CREATE INDEX "NationalLifeExportUpload_agentId_createdAt_idx" ON "NationalLifeExportUpload"("agentId", "createdAt");
CREATE INDEX "NationalLifeExportUpload_state_updatedAt_idx" ON "NationalLifeExportUpload"("state", "updatedAt");
CREATE UNIQUE INDEX "NationalLifeExportChunk_uploadId_sequence_key" ON "NationalLifeExportChunk"("uploadId", "sequence");
CREATE INDEX "NationalLifeExportChunk_uploadId_byteOffset_idx" ON "NationalLifeExportChunk"("uploadId", "byteOffset");

ALTER TABLE "NationalLifeExportUpload" ADD CONSTRAINT "NationalLifeExportUpload_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalLifeExportUpload" ADD CONSTRAINT "NationalLifeExportUpload_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "NationalLifeConnectorDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalLifeExportUpload" ADD CONSTRAINT "NationalLifeExportUpload_runId_fkey" FOREIGN KEY ("runId") REFERENCES "NationalLifeSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalLifeExportChunk" ADD CONSTRAINT "NationalLifeExportChunk_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "NationalLifeExportUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
