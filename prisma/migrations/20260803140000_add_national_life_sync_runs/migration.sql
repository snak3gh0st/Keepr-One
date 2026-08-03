ALTER TYPE "BrowserJobOperation" ADD VALUE 'SYNC_NATIONAL_LIFE_GRID';

CREATE TYPE "NationalLifeSyncRunState" AS ENUM (
    'QUEUED',
    'RUNNING',
    'PAUSED',
    'COMPLETED',
    'PARTIAL',
    'FAILED'
);

CREATE TABLE "NationalLifeSyncRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deploymentScope" TEXT NOT NULL DEFAULT 'SINGLE_DEPLOYMENT',
    "provider" TEXT NOT NULL DEFAULT 'NATIONAL_LIFE',
    "state" "NationalLifeSyncRunState" NOT NULL DEFAULT 'QUEUED',
    "totalStages" INTEGER NOT NULL,
    "completedStages" INTEGER NOT NULL DEFAULT 0,
    "failedStages" INTEGER NOT NULL DEFAULT 0,
    "currentGridKey" TEXT,
    "safeErrorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalLifeSyncRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BrowserAutomationJob"
    ADD COLUMN "syncRunId" TEXT,
    ADD COLUMN "syncStageIndex" INTEGER,
    ADD COLUMN "syncGridKey" TEXT;

CREATE INDEX "NationalLifeSyncRun_agentId_deploymentScope_state_createdAt_idx"
    ON "NationalLifeSyncRun"("agentId", "deploymentScope", "state", "createdAt");

CREATE INDEX "BrowserAutomationJob_syncRunId_syncStageIndex_state_idx"
    ON "BrowserAutomationJob"("syncRunId", "syncStageIndex", "state");

ALTER TABLE "NationalLifeSyncRun"
    ADD CONSTRAINT "NationalLifeSyncRun_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BrowserAutomationJob"
    ADD CONSTRAINT "BrowserAutomationJob_syncRunId_fkey"
    FOREIGN KEY ("syncRunId") REFERENCES "NationalLifeSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
