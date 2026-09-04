ALTER TABLE "AgentOnboarding"
  ADD COLUMN "nationalLifeSkippedAt" TIMESTAMP(3);

ALTER TABLE "AgentOnboarding"
  ADD CONSTRAINT "AgentOnboarding_national_life_skipped_timestamp" CHECK (
    "nationalLifeSkippedAt" IS NULL OR "nationalLifeSkippedAt" >= "createdAt"
  ),
  ADD CONSTRAINT "AgentOnboarding_national_life_outcome" CHECK (
    "nationalLifeSkippedAt" IS NULL
    OR
    (
      "nationalLifeVerifiedAt" IS NULL
      AND "nationalLifeVerificationSource" IS NULL
    )
  );

ALTER TABLE "AgentOnboarding"
  DROP CONSTRAINT "AgentOnboarding_lifecycle",
  ADD CONSTRAINT "AgentOnboarding_lifecycle" CHECK (
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
      AND (
        "nationalLifeVerifiedAt" IS NOT NULL
        OR "nationalLifeSkippedAt" IS NOT NULL
      )
      AND "calendarDecision" IS NOT NULL
      AND "whatsappDecision" IS NOT NULL
      AND "requiredModules" <@ "completedModules"
    )
  );
