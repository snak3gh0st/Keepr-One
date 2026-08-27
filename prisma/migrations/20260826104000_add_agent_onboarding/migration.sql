CREATE TYPE "AgentOnboardingStatus" AS ENUM (
  'IN_PROGRESS',
  'COMPLETED'
);

CREATE TYPE "AgentOnboardingStep" AS ENUM (
  'WELCOME',
  'PROFILE',
  'NATIONAL_LIFE',
  'CALENDAR',
  'WHATSAPP',
  'MODULES',
  'REVIEW',
  'COMPLETED'
);

CREATE TYPE "AgentOnboardingOptionalDecision" AS ENUM (
  'CONNECTED',
  'SKIPPED'
);

CREATE TYPE "AgentOnboardingModule" AS ENUM (
  'TODAY',
  'CALENDAR',
  'CRM',
  'MESSAGES',
  'POLICIES',
  'ILLUSTRATIONS',
  'COMMISSIONS',
  'JOURNEY',
  'TEAM',
  'INTEGRATIONS'
);

CREATE TYPE "AgentOnboardingNationalLifeSource" AS ENUM (
  'LOCAL_CONNECTOR_SYNC'
);

CREATE TABLE "AgentOnboarding" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "status" "AgentOnboardingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "currentStep" "AgentOnboardingStep" NOT NULL DEFAULT 'WELCOME',
  "welcomeCompletedAt" TIMESTAMP(3),
  "profileCompletedAt" TIMESTAMP(3),
  "nationalLifeVerifiedAt" TIMESTAMP(3),
  "nationalLifeVerificationSource" "AgentOnboardingNationalLifeSource",
  "calendarDecision" "AgentOnboardingOptionalDecision",
  "calendarDecidedAt" TIMESTAMP(3),
  "whatsappDecision" "AgentOnboardingOptionalDecision",
  "whatsappDecidedAt" TIMESTAMP(3),
  "requiredModules" "AgentOnboardingModule"[] NOT NULL,
  "completedModules" "AgentOnboardingModule"[] NOT NULL DEFAULT ARRAY[]::"AgentOnboardingModule"[],
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentOnboarding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentOnboarding_profile_timestamp" CHECK (
    "profileCompletedAt" IS NULL OR "profileCompletedAt" >= "createdAt"
  ),
  CONSTRAINT "AgentOnboarding_national_life_evidence" CHECK (
    ("nationalLifeVerifiedAt" IS NULL AND "nationalLifeVerificationSource" IS NULL)
    OR
    ("nationalLifeVerifiedAt" IS NOT NULL AND "nationalLifeVerificationSource" IS NOT NULL)
  ),
  CONSTRAINT "AgentOnboarding_calendar_decision" CHECK (
    ("calendarDecision" IS NULL AND "calendarDecidedAt" IS NULL)
    OR
    ("calendarDecision" IS NOT NULL AND "calendarDecidedAt" IS NOT NULL)
  ),
  CONSTRAINT "AgentOnboarding_whatsapp_decision" CHECK (
    ("whatsappDecision" IS NULL AND "whatsappDecidedAt" IS NULL)
    OR
    ("whatsappDecision" IS NOT NULL AND "whatsappDecidedAt" IS NOT NULL)
  ),
  CONSTRAINT "AgentOnboarding_required_modules_not_empty" CHECK (
    cardinality("requiredModules") > 0
  ),
  CONSTRAINT "AgentOnboarding_completed_modules_required" CHECK (
    "completedModules" <@ "requiredModules"
  ),
  CONSTRAINT "AgentOnboarding_lifecycle" CHECK (
    (
      "status" = 'IN_PROGRESS'
      AND "currentStep" <> 'COMPLETED'
      AND "completedAt" IS NULL
    )
    OR
    (
      "status" = 'COMPLETED'
      AND "currentStep" = 'COMPLETED'
      AND "completedAt" IS NOT NULL
      AND "welcomeCompletedAt" IS NOT NULL
      AND "profileCompletedAt" IS NOT NULL
      AND "nationalLifeVerifiedAt" IS NOT NULL
      AND "calendarDecision" IS NOT NULL
      AND "whatsappDecision" IS NOT NULL
      AND "requiredModules" <@ "completedModules"
    )
  )
);

CREATE UNIQUE INDEX "AgentOnboarding_agentId_key"
  ON "AgentOnboarding"("agentId");

CREATE INDEX "AgentOnboarding_status_currentStep_idx"
  ON "AgentOnboarding"("status", "currentStep");

ALTER TABLE "AgentOnboarding"
  ADD CONSTRAINT "AgentOnboarding_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Deliberately no backfill: absence is the grandfathering marker for accounts
-- that existed before the guided onboarding was introduced.
