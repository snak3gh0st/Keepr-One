ALTER TABLE "NationalLifeConnectionAttempt"
  ADD COLUMN "nextPollAt" TIMESTAMP(3),
  ADD COLUMN "reconnectAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "browserProvider" TEXT,
  ADD COLUMN "browserShardId" TEXT,
  ADD COLUMN "lastTransportFailureAt" TIMESTAMP(3);

CREATE INDEX "NationalLifeConnectionAttempt_state_nextPollAt_idx"
  ON "NationalLifeConnectionAttempt"("state", "nextPollAt");
