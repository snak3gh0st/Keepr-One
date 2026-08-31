CREATE TYPE "SchedulingEmailJobStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'DEAD_LETTER',
  'CANCELLED'
);

CREATE TABLE "SchedulingEmailJob" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "status" "SchedulingEmailJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "idempotencyKey" TEXT NOT NULL,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "providerMessageId" TEXT,
  "lastErrorCode" TEXT,
  "sentAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SchedulingEmailJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchedulingEmailJob_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "SchedulingEmailJob_payload_version_check" CHECK ("payloadVersion" = 1),
  CONSTRAINT "SchedulingEmailJob_idempotency_key_check" CHECK (char_length("idempotencyKey") BETWEEN 16 AND 255),
  CONSTRAINT "SchedulingEmailJob_lease_check" CHECK (
    ("status" = 'PROCESSING' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR
    ("status" <> 'PROCESSING' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
  ),
  CONSTRAINT "SchedulingEmailJob_success_check" CHECK (
    ("status" = 'SUCCEEDED' AND "sentAt" IS NOT NULL AND "providerMessageId" IS NOT NULL)
    OR
    ("status" <> 'SUCCEEDED')
  )
);

CREATE UNIQUE INDEX "SchedulingEmailJob_bookingId_key"
  ON "SchedulingEmailJob"("bookingId");
CREATE UNIQUE INDEX "SchedulingEmailJob_idempotencyKey_key"
  ON "SchedulingEmailJob"("idempotencyKey");
CREATE INDEX "SchedulingEmailJob_status_availableAt_idx"
  ON "SchedulingEmailJob"("status", "availableAt");
CREATE INDEX "SchedulingEmailJob_leaseExpiresAt_idx"
  ON "SchedulingEmailJob"("leaseExpiresAt");

ALTER TABLE "SchedulingEmailJob"
  ADD CONSTRAINT "SchedulingEmailJob_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "SchedulingBooking"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
