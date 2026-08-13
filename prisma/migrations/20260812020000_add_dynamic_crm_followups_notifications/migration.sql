-- Dynamic, agent-owned CRM pipeline. "Todos" remains a virtual filter.
CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "CrmPipeline" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmPipeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmStage" (
  "id" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "systemKey" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmStage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InsuranceCase" ADD COLUMN "crmStageId" TEXT;

CREATE TABLE "FollowUp" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "ownerAgentId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Follow-up',
  "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
  "completedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "sourceTimelineEventId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "followUpId" TEXT,
  "caseId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "href" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "readAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmPipeline_agentId_key" ON "CrmPipeline"("agentId");
CREATE UNIQUE INDEX "CrmStage_pipelineId_systemKey_key" ON "CrmStage"("pipelineId", "systemKey");
-- One durable order slot per pipeline. Mutation services lock the parent row
-- and park positions before rewriting them, so concurrent create/reorder calls
-- serialize without producing duplicate positions.
CREATE UNIQUE INDEX "CrmStage_pipelineId_active_position_key"
  ON "CrmStage"("pipelineId", "position") WHERE "active" = true;
CREATE INDEX "CrmStage_pipelineId_active_position_idx" ON "CrmStage"("pipelineId", "active", "position");
CREATE INDEX "InsuranceCase_assignedAgentId_crmStageId_idx" ON "InsuranceCase"("assignedAgentId", "crmStageId");
CREATE UNIQUE INDEX "FollowUp_sourceTimelineEventId_key" ON "FollowUp"("sourceTimelineEventId");
CREATE INDEX "FollowUp_ownerAgentId_status_scheduledAt_idx" ON "FollowUp"("ownerAgentId", "status", "scheduledAt");
CREATE INDEX "FollowUp_caseId_status_scheduledAt_idx" ON "FollowUp"("caseId", "status", "scheduledAt");
CREATE INDEX "FollowUp_status_scheduledAt_idx" ON "FollowUp"("status", "scheduledAt");
-- A lead has one actionable "next follow-up" at a time. Completed/cancelled
-- records remain as immutable history and do not participate in uniqueness.
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_recipientUserId_readAt_createdAt_idx" ON "Notification"("recipientUserId", "readAt", "createdAt");
CREATE INDEX "Notification_followUpId_idx" ON "Notification"("followUpId");
CREATE INDEX "Notification_caseId_idx" ON "Notification"("caseId");

ALTER TABLE "CrmPipeline" ADD CONSTRAINT "CrmPipeline_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "CrmPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InsuranceCase" ADD CONSTRAINT "InsuranceCase_crmStageId_fkey" FOREIGN KEY ("crmStageId") REFERENCES "CrmStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "InsuranceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_ownerAgentId_fkey" FOREIGN KEY ("ownerAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_sourceTimelineEventId_fkey" FOREIGN KEY ("sourceTimelineEventId") REFERENCES "CaseTimelineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "InsuranceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing agent gets the exact default pipeline. Deterministic IDs make
-- the migration rerunnable in shadow/recovery environments without ambiguity.
INSERT INTO "CrmPipeline" ("id", "agentId", "createdAt", "updatedAt")
SELECT 'crm_pipeline_' || "id", "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "Agent";

WITH defaults("position", "systemKey", "name") AS (
  VALUES
    (0, 'NEW_LEAD', 'Novo Lead'),
    (1, 'FOLLOW_UP', 'Follow-up'),
    (2, 'IN_CONTACT', 'Em Contato'),
    (3, 'QUALIFIED', 'Qualificado'),
    (4, 'FIRST_MEETING_SCHEDULED', 'Primeira Reunião Marcada'),
    (5, 'RESCHEDULE_FIRST_MEETING', 'Reagendar Primeira Reunião'),
    (6, 'CREATE_ILLUSTRATION', 'Fazer Ilustração'),
    (7, 'ILLUSTRATION_SCHEDULED', 'Ilustração Agendada'),
    (8, 'RESCHEDULE_ILLUSTRATION', 'Reagendar Ilustração'),
    (9, 'CONTRACT_CLOSED', 'Contrato Fechado'),
    (10, 'APPLICATION', 'Aplicação'),
    (11, 'POLICY_ISSUED', 'Apólice Emitida'),
    (12, 'ACTIVE_CLIENT', 'Cliente Ativo'),
    (13, 'LOST', 'Perdido')
)
INSERT INTO "CrmStage" ("id", "pipelineId", "name", "position", "systemKey", "active", "createdAt", "updatedAt")
SELECT 'crm_stage_' || a."id" || '_' || d."position", 'crm_pipeline_' || a."id", d."name", d."position", d."systemKey", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Agent" a CROSS JOIN defaults d;

-- Compatibility mapping from the legacy CaseStage enum. No existing case is
-- deleted or left without a dynamic stage after this migration.
UPDATE "InsuranceCase" c
SET "crmStageId" = 'crm_stage_' || c."assignedAgentId" || '_' ||
  CASE c."stage"
    WHEN 'LEAD' THEN '0'
    WHEN 'DISCOVERY' THEN '2'
    WHEN 'DESIGN' THEN '3'
    WHEN 'ILLUSTRATION_READY' THEN '7'
    WHEN 'APPLICATION_STARTED' THEN '10'
    WHEN 'SUBMITTED' THEN '10'
    WHEN 'UNDERWRITING' THEN '10'
    WHEN 'APPROVED' THEN '9'
    WHEN 'ISSUED' THEN '11'
    WHEN 'PLACED' THEN '12'
    WHEN 'DECLINED' THEN '13'
    WHEN 'WITHDRAWN' THEN '13'
    ELSE '0'
  END;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "InsuranceCase" WHERE "crmStageId" IS NULL) THEN
    RAISE EXCEPTION 'CRM migration aborted: one or more existing cases have no dynamic stage';
  END IF;
END $$;

-- Preserve legacy follow-ups as first-class records. The timeline event remains
-- the historical source and is linked one-to-one for traceability.
-- Defensive dedupe: old screens allowed repeated submissions; one legacy event
-- can map to at most one dedicated FollowUp and the unique link enforces it.
INSERT INTO "FollowUp" (
  "id", "caseId", "ownerAgentId", "createdByUserId", "title", "scheduledAt",
  "status", "completedAt", "cancelledAt", "sourceTimelineEventId", "createdAt", "updatedAt"
)
SELECT
  'followup_legacy_' || e."id", e."caseId", c."assignedAgentId", a."userId",
  e."title",
  -- Legacy date inputs were parsed as UTC midnight. Preserve the user's
  -- intended calendar date and make them actionable at 09:00 New York time.
  ((e."dueAt"::date + TIME '09:00') AT TIME ZONE 'America/New_York'),
  CASE
    WHEN e."doneAt" IS NOT NULL THEN 'COMPLETED'::"FollowUpStatus"
    WHEN e."open_rank" = 1 THEN 'SCHEDULED'::"FollowUpStatus"
    ELSE 'CANCELLED'::"FollowUpStatus"
  END,
  e."doneAt" AT TIME ZONE 'UTC',
  CASE WHEN e."doneAt" IS NULL AND e."open_rank" > 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
  e."id", e."createdAt" AT TIME ZONE 'UTC', CURRENT_TIMESTAMP
FROM (
  SELECT legacy.*,
    CASE WHEN legacy."doneAt" IS NULL THEN
      ROW_NUMBER() OVER (
        PARTITION BY legacy."caseId", (legacy."doneAt" IS NULL)
        ORDER BY legacy."createdAt" DESC, legacy."id" DESC
      )
    ELSE NULL END AS "open_rank"
  FROM "CaseTimelineEvent" legacy
  WHERE legacy."type" = 'FOLLOW_UP' AND legacy."dueAt" IS NOT NULL
) e
JOIN "InsuranceCase" c ON c."id" = e."caseId"
JOIN "Agent" a ON a."id" = c."assignedAgentId"
;

-- Duplicate legacy reminders that were no longer actionable are preserved as
-- CANCELLED follow-ups. Close their original timeline rows at the exact same
-- instant so the migrated history cannot render them as perpetually overdue.
-- CaseTimelineEvent uses a timestamp without timezone, normalized to UTC.
UPDATE "CaseTimelineEvent" AS timeline
SET "doneAt" = follow_up."cancelledAt" AT TIME ZONE 'UTC'
FROM "FollowUp" AS follow_up
WHERE follow_up."sourceTimelineEventId" = timeline."id"
  AND follow_up."status" = 'CANCELLED'::"FollowUpStatus"
  AND timeline."doneAt" IS NULL
  AND follow_up."cancelledAt" IS NOT NULL;

-- Added after the lossless legacy backfill: only one of potentially many old
-- open reminders was promoted to the actionable SCHEDULED state; the rest are
-- preserved as CANCELLED history.
CREATE UNIQUE INDEX "FollowUp_one_scheduled_per_case_key"
  ON "FollowUp"("caseId") WHERE "status" = 'SCHEDULED';

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "FollowUp" WHERE "sourceTimelineEventId" IS NOT NULL)
     <> (SELECT COUNT(*) FROM "CaseTimelineEvent" WHERE "type" = 'FOLLOW_UP' AND "dueAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'CRM migration aborted: not every legacy follow-up was backfilled';
  END IF;
END $$;
