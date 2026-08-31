CREATE TYPE "SchedulingBookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

CREATE TABLE "SchedulingPage" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "title" TEXT NOT NULL DEFAULT 'Reunião',
  "description" TEXT,
  "durationMinutes" INTEGER NOT NULL DEFAULT 30,
  "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
  "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
  "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
  "minimumNoticeMinutes" INTEGER NOT NULL DEFAULT 120,
  "maximumAdvanceDays" INTEGER NOT NULL DEFAULT 60,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SchedulingPage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchedulingPage_slug_check" CHECK (
    char_length("slug") BETWEEN 3 AND 64
    AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  CONSTRAINT "SchedulingPage_copy_check" CHECK (
    char_length(btrim("title")) BETWEEN 1 AND 120
    AND ("description" IS NULL OR char_length("description") <= 1000)
  ),
  CONSTRAINT "SchedulingPage_duration_check" CHECK (
    "durationMinutes" BETWEEN 5 AND 480
    AND "slotIntervalMinutes" BETWEEN 5 AND 480
    AND "bufferBeforeMinutes" BETWEEN 0 AND 1440
    AND "bufferAfterMinutes" BETWEEN 0 AND 1440
    AND "minimumNoticeMinutes" BETWEEN 0 AND 43200
    AND "maximumAdvanceDays" BETWEEN 1 AND 365
  )
);

CREATE TABLE "SchedulingWeeklyWindow" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchedulingWeeklyWindow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchedulingWeeklyWindow_bounds_check" CHECK (
    "weekday" BETWEEN 0 AND 6
    AND "startMinute" BETWEEN 0 AND 1439
    AND "endMinute" BETWEEN 1 AND 1440
    AND "endMinute" > "startMinute"
  )
);

CREATE TABLE "SchedulingBooking" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "calendarEventId" TEXT,
  "inviteeName" TEXT NOT NULL,
  "inviteeEmail" TEXT NOT NULL,
  "inviteePhone" TEXT,
  "inviteeTimeZone" TEXT NOT NULL,
  "notes" TEXT,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "blockedStartsAt" TIMESTAMPTZ(3) NOT NULL,
  "blockedEndsAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "SchedulingBookingStatus" NOT NULL DEFAULT 'CONFIRMED',
  "idempotencyKeyHash" TEXT NOT NULL,
  "manageTokenHash" TEXT NOT NULL,
  "cancelledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SchedulingBooking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchedulingBooking_schedule_check" CHECK (
    "blockedStartsAt" <= "startsAt"
    AND "startsAt" < "endsAt"
    AND "endsAt" <= "blockedEndsAt"
  ),
  CONSTRAINT "SchedulingBooking_guest_check" CHECK (
    char_length(btrim("inviteeName")) BETWEEN 2 AND 100
    AND char_length("inviteeEmail") BETWEEN 3 AND 254
    AND char_length("inviteeTimeZone") BETWEEN 1 AND 100
    AND ("inviteePhone" IS NULL OR char_length("inviteePhone") <= 30)
    AND ("notes" IS NULL OR char_length("notes") <= 1000)
  ),
  CONSTRAINT "SchedulingBooking_hashes_check" CHECK (
    "idempotencyKeyHash" ~ '^[a-f0-9]{64}$'
    AND "manageTokenHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "SchedulingBooking_cancellation_check" CHECK (
    ("status" = 'CONFIRMED' AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "SchedulingPage_ownerUserId_key" ON "SchedulingPage"("ownerUserId");
CREATE UNIQUE INDEX "SchedulingPage_slug_key" ON "SchedulingPage"("slug");
CREATE INDEX "SchedulingPage_enabled_slug_idx" ON "SchedulingPage"("enabled", "slug");

CREATE UNIQUE INDEX "SchedulingWeeklyWindow_page_weekday_start_end_key"
  ON "SchedulingWeeklyWindow"("pageId", "weekday", "startMinute", "endMinute");
CREATE INDEX "SchedulingWeeklyWindow_page_weekday_idx"
  ON "SchedulingWeeklyWindow"("pageId", "weekday");

CREATE UNIQUE INDEX "SchedulingBooking_calendarEventId_key" ON "SchedulingBooking"("calendarEventId");
CREATE UNIQUE INDEX "SchedulingBooking_idempotencyKeyHash_key" ON "SchedulingBooking"("idempotencyKeyHash");
CREATE UNIQUE INDEX "SchedulingBooking_manageTokenHash_key" ON "SchedulingBooking"("manageTokenHash");
CREATE INDEX "SchedulingBooking_owner_starts_status_idx"
  ON "SchedulingBooking"("ownerUserId", "startsAt", "status");
CREATE INDEX "SchedulingBooking_page_starts_status_idx"
  ON "SchedulingBooking"("pageId", "startsAt", "status");
CREATE INDEX "SchedulingBooking_inviteeEmail_createdAt_idx"
  ON "SchedulingBooking"("inviteeEmail", "createdAt");

ALTER TABLE "SchedulingPage"
  ADD CONSTRAINT "SchedulingPage_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SchedulingWeeklyWindow"
  ADD CONSTRAINT "SchedulingWeeklyWindow_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "SchedulingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SchedulingBooking"
  ADD CONSTRAINT "SchedulingBooking_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "SchedulingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchedulingBooking"
  ADD CONSTRAINT "SchedulingBooking_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchedulingBooking"
  ADD CONSTRAINT "SchedulingBooking_calendarEventId_fkey"
  FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The public booking path must never confirm two overlapping reservations for
-- one owner. Half-open ranges keep adjacent slots valid, while the stored
-- blocked bounds include the event type's before/after buffers.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "SchedulingBooking"
  ADD CONSTRAINT "SchedulingBooking_owner_active_range_excl"
  EXCLUDE USING gist (
    "ownerUserId" WITH =,
    tstzrange("blockedStartsAt", "blockedEndsAt", '[)') WITH &&
  ) WHERE ("status" = 'CONFIRMED');
