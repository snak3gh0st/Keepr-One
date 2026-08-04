-- CreateEnum
CREATE TYPE "NationalLifeForesightReadRunState" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'PARTIAL', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NationalLifeForesightReadMode" AS ENUM ('INVENTORY', 'DETAIL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BrowserJobOperation" ADD VALUE 'SYNC_FORESIGHT_READ';
ALTER TYPE "BrowserJobOperation" ADD VALUE 'GENERATE_FORESIGHT_PDF';

-- AlterTable
ALTER TABLE "BrowserAutomationJob" ADD COLUMN     "foresightRunId" TEXT;

-- CreateTable
CREATE TABLE "NationalLifeForesightReadRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deploymentScope" TEXT NOT NULL DEFAULT 'SINGLE_DEPLOYMENT',
    "provider" TEXT NOT NULL DEFAULT 'NATIONAL_LIFE',
    "mode" "NationalLifeForesightReadMode" NOT NULL,
    "state" "NationalLifeForesightReadRunState" NOT NULL DEFAULT 'QUEUED',
    "targetCaseId" TEXT,
    "totalCases" INTEGER NOT NULL DEFAULT 0,
    "inventoriedCases" INTEGER NOT NULL DEFAULT 0,
    "totalServices" INTEGER NOT NULL DEFAULT 0,
    "completedServices" INTEGER NOT NULL DEFAULT 0,
    "currentCaseName" TEXT,
    "currentService" TEXT,
    "safeErrorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeForesightReadRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NationalLifeForesightCaseSnapshot" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deploymentScope" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'NATIONAL_LIFE',
    "externalKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "caseKind" TEXT,
    "product" TEXT,
    "status" TEXT,
    "state" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeForesightCaseSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NationalLifeForesightServiceSnapshot" (
    "id" TEXT NOT NULL,
    "caseSnapshotId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deploymentScope" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'NATIONAL_LIFE',
    "serviceName" TEXT NOT NULL,
    "payloadShape" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "validationState" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeForesightServiceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NationalLifeForesightDocument" (
    "id" TEXT NOT NULL,
    "caseSnapshotId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deploymentScope" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'NATIONAL_LIFE',
    "reportKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "renderState" TEXT NOT NULL,
    "safeErrorCode" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeForesightDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NationalLifeForesightReadRun_agentId_deploymentScope_state__idx" ON "NationalLifeForesightReadRun"("agentId", "deploymentScope", "state", "createdAt");

-- CreateIndex
CREATE INDEX "NationalLifeForesightCaseSnapshot_agentId_deploymentScope_o_idx" ON "NationalLifeForesightCaseSnapshot"("agentId", "deploymentScope", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NationalLifeForesightCaseSnapshot_agentId_deploymentScope_p_key" ON "NationalLifeForesightCaseSnapshot"("agentId", "deploymentScope", "provider", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "NationalLifeForesightCaseSnapshot_id_agentId_deploymentScop_key" ON "NationalLifeForesightCaseSnapshot"("id", "agentId", "deploymentScope", "provider");

-- CreateIndex
CREATE INDEX "NationalLifeForesightServiceSnapshot_caseSnapshotId_observe_idx" ON "NationalLifeForesightServiceSnapshot"("caseSnapshotId", "observedAt");

-- CreateIndex
CREATE INDEX "NationalLifeForesightServiceSnapshot_agentId_deploymentScop_idx" ON "NationalLifeForesightServiceSnapshot"("agentId", "deploymentScope", "provider", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NationalLifeForesightServiceSnapshot_caseSnapshotId_service_key" ON "NationalLifeForesightServiceSnapshot"("caseSnapshotId", "serviceName");

-- CreateIndex
CREATE INDEX "NationalLifeForesightDocument_caseSnapshotId_createdAt_idx" ON "NationalLifeForesightDocument"("caseSnapshotId", "createdAt");

-- CreateIndex
CREATE INDEX "NationalLifeForesightDocument_agentId_deploymentScope_provi_idx" ON "NationalLifeForesightDocument"("agentId", "deploymentScope", "provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NationalLifeForesightDocument_caseSnapshotId_reportKey_key" ON "NationalLifeForesightDocument"("caseSnapshotId", "reportKey");

-- AddForeignKey
ALTER TABLE "NationalLifeForesightReadRun" ADD CONSTRAINT "NationalLifeForesightReadRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NationalLifeForesightCaseSnapshot" ADD CONSTRAINT "NationalLifeForesightCaseSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NationalLifeForesightServiceSnapshot" ADD CONSTRAINT "NationalLifeForesightServiceSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NationalLifeForesightServiceSnapshot" ADD CONSTRAINT "NationalLifeForesightServiceSnapshot_caseSnapshotId_agentI_fkey" FOREIGN KEY ("caseSnapshotId", "agentId", "deploymentScope", "provider") REFERENCES "NationalLifeForesightCaseSnapshot"("id", "agentId", "deploymentScope", "provider") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NationalLifeForesightDocument" ADD CONSTRAINT "NationalLifeForesightDocument_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NationalLifeForesightDocument" ADD CONSTRAINT "NationalLifeForesightDocument_caseSnapshotId_agentId_deplo_fkey" FOREIGN KEY ("caseSnapshotId", "agentId", "deploymentScope", "provider") REFERENCES "NationalLifeForesightCaseSnapshot"("id", "agentId", "deploymentScope", "provider") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserAutomationJob" ADD CONSTRAINT "BrowserAutomationJob_foresightRunId_fkey" FOREIGN KEY ("foresightRunId") REFERENCES "NationalLifeForesightReadRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
