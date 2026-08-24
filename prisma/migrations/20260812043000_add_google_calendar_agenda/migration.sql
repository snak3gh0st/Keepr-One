CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE');
CREATE TYPE "CalendarIntegrationStatus" AS ENUM ('CONNECTED', 'RECONNECT_REQUIRED', 'ERROR', 'DISCONNECTED');
CREATE TYPE "CalendarSyncStatus" AS ENUM ('SYNCED', 'PENDING', 'PROCESSING', 'ERROR');
CREATE TYPE "CalendarEventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');
CREATE TYPE "CalendarEventSource" AS ENUM ('CRM', 'GOOGLE');
CREATE TYPE "CalendarAttendeeResponseStatus" AS ENUM ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE');
CREATE TYPE "CalendarWatchStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'STOPPED', 'ERROR');
CREATE TYPE "CalendarSyncDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'RECONCILE', 'RENEW_WATCH');
CREATE TYPE "CalendarSyncOperation" AS ENUM ('CREATE_EVENT', 'UPDATE_EVENT', 'DELETE_EVENT', 'INCREMENTAL_SYNC', 'FULL_SYNC', 'RENEW_WATCH', 'STOP_WATCH');
CREATE TYPE "CalendarSyncJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER');

ALTER TABLE "user"
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/New_York';

CREATE TABLE "CalendarIntegration" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "CalendarProvider" NOT NULL DEFAULT 'GOOGLE',
  "providerAccountId" TEXT NOT NULL,
  "providerEmail" TEXT NOT NULL,
  "displayName" TEXT,
  "status" "CalendarIntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
  "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "accessKeyVersion" TEXT,
  "accessAlgorithm" TEXT,
  "accessIv" TEXT,
  "accessCiphertext" TEXT,
  "accessAuthTag" TEXT,
  "refreshKeyVersion" TEXT,
  "refreshAlgorithm" TEXT,
  "refreshIv" TEXT,
  "refreshCiphertext" TEXT,
  "refreshAuthTag" TEXT,
  "tokenExpiresAt" TIMESTAMPTZ(3),
  "connectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "disconnectedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CalendarIntegration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarIntegration_access_token_shape_check" CHECK (
    ("accessKeyVersion" IS NULL AND "accessAlgorithm" IS NULL AND "accessIv" IS NULL AND "accessCiphertext" IS NULL AND "accessAuthTag" IS NULL)
    OR
    ("accessKeyVersion" IS NOT NULL AND "accessAlgorithm" IS NOT NULL AND "accessIv" IS NOT NULL AND "accessCiphertext" IS NOT NULL AND "accessAuthTag" IS NOT NULL)
  ),
  CONSTRAINT "CalendarIntegration_refresh_token_shape_check" CHECK (
    ("refreshKeyVersion" IS NULL AND "refreshAlgorithm" IS NULL AND "refreshIv" IS NULL AND "refreshCiphertext" IS NULL AND "refreshAuthTag" IS NULL)
    OR
    ("refreshKeyVersion" IS NOT NULL AND "refreshAlgorithm" IS NOT NULL AND "refreshIv" IS NOT NULL AND "refreshCiphertext" IS NOT NULL AND "refreshAuthTag" IS NOT NULL)
  )
);

CREATE TABLE "CalendarSource" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "providerCalendarId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "colorId" TEXT,
  "backgroundColor" TEXT,
  "foregroundColor" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "visible" BOOLEAN NOT NULL DEFAULT true,
  "crmDefault" BOOLEAN NOT NULL DEFAULT false,
  "accessRole" TEXT,
  "timeZone" TEXT,
  "syncToken" TEXT,
  "syncStatus" "CalendarSyncStatus" NOT NULL DEFAULT 'PENDING',
  "lastIncrementalSyncAt" TIMESTAMPTZ(3),
  "lastFullSyncAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CalendarSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarEvent" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL,
  "insuranceCaseId" TEXT,
  "providerEventId" TEXT,
  "providerRecurringEventId" TEXT,
  "providerOriginalStartAt" TIMESTAMPTZ(3),
  "providerOriginalStartDate" DATE,
  "recurrence" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "iCalUid" TEXT,
  "etag" TEXT,
  "sequence" INTEGER,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startsAt" TIMESTAMPTZ(3),
  "endsAt" TIMESTAMPTZ(3),
  "startDate" DATE,
  "endDate" DATE,
  "timeZone" TEXT,
  "allDay" BOOLEAN NOT NULL DEFAULT false,
  "location" TEXT,
  "meetingUrl" TEXT,
  "conferenceData" JSONB,
  "reminders" JSONB,
  "colorId" TEXT,
  "visibility" TEXT,
  "transparency" TEXT,
  "status" "CalendarEventStatus" NOT NULL DEFAULT 'CONFIRMED',
  "source" "CalendarEventSource" NOT NULL DEFAULT 'GOOGLE',
  "syncStatus" "CalendarSyncStatus" NOT NULL DEFAULT 'PENDING',
  "syncErrorCode" TEXT,
  "providerUpdatedAt" TIMESTAMPTZ(3),
  "deletedAt" TIMESTAMPTZ(3),
  "lastSyncedAt" TIMESTAMPTZ(3),
  "localRevision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarEvent_time_shape_check" CHECK (
    ("allDay" = true AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "startsAt" IS NULL AND "endsAt" IS NULL AND "endDate" > "startDate")
    OR
    ("allDay" = false AND "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "startDate" IS NULL AND "endDate" IS NULL AND "endsAt" > "startsAt")
  ),
  CONSTRAINT "CalendarEvent_localRevision_check" CHECK ("localRevision" >= 1)
);

CREATE TABLE "CalendarEventAttendee" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "responseStatus" "CalendarAttendeeResponseStatus" NOT NULL DEFAULT 'NEEDS_ACTION',
  "isSelf" BOOLEAN NOT NULL DEFAULT false,
  "isOrganizer" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CalendarEventAttendee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarWatchChannel" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL,
  "providerChannelId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "resourceUri" TEXT,
  "channelTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lastMessageNumber" BIGINT,
  "status" "CalendarWatchStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastReceivedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CalendarWatchChannel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarSyncJob" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "calendarId" TEXT,
  "eventId" TEXT,
  "direction" "CalendarSyncDirection" NOT NULL,
  "operation" "CalendarSyncOperation" NOT NULL,
  "status" "CalendarSyncJobStatus" NOT NULL DEFAULT 'PENDING',
  "desiredRevision" INTEGER,
  "sendInvites" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "idempotencyKey" TEXT NOT NULL,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CalendarSyncJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarSyncJob_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "CalendarSyncJob_desiredRevision_check" CHECK ("desiredRevision" IS NULL OR "desiredRevision" >= 1)
);

CREATE TABLE "CalendarOAuthState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "CalendarProvider" NOT NULL DEFAULT 'GOOGLE',
  "stateHash" TEXT NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "verifierKeyVersion" TEXT NOT NULL,
  "verifierAlgorithm" TEXT NOT NULL,
  "verifierIv" TEXT NOT NULL,
  "verifierCiphertext" TEXT NOT NULL,
  "verifierAuthTag" TEXT NOT NULL,
  "returnTo" TEXT,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarIntegration_user_provider_key" ON "CalendarIntegration"("userId", "provider");
CREATE INDEX "CalendarIntegration_user_status_idx" ON "CalendarIntegration"("userId", "status");
CREATE INDEX "CalendarIntegration_provider_status_idx" ON "CalendarIntegration"("provider", "status");
CREATE UNIQUE INDEX "CalendarSource_integration_providerCalendar_key" ON "CalendarSource"("integrationId", "providerCalendarId");
CREATE INDEX "CalendarSource_integration_visible_idx" ON "CalendarSource"("integrationId", "visible");
CREATE INDEX "CalendarSource_integration_default_idx" ON "CalendarSource"("integrationId", "crmDefault");
CREATE UNIQUE INDEX "CalendarSource_one_crm_default_key" ON "CalendarSource"("integrationId") WHERE "crmDefault" = true;
CREATE UNIQUE INDEX "CalendarEvent_calendar_providerEvent_key" ON "CalendarEvent"("calendarId", "providerEventId");
CREATE INDEX "CalendarEvent_owner_starts_status_idx" ON "CalendarEvent"("ownerUserId", "startsAt", "status");
CREATE INDEX "CalendarEvent_owner_startDate_status_idx" ON "CalendarEvent"("ownerUserId", "startDate", "status");
CREATE INDEX "CalendarEvent_case_starts_idx" ON "CalendarEvent"("insuranceCaseId", "startsAt");
CREATE INDEX "CalendarEvent_integration_syncStatus_idx" ON "CalendarEvent"("integrationId", "syncStatus");
CREATE INDEX "CalendarEvent_recurring_originalStart_idx" ON "CalendarEvent"("providerRecurringEventId", "providerOriginalStartAt");
CREATE UNIQUE INDEX "CalendarEventAttendee_event_email_key" ON "CalendarEventAttendee"("eventId", "email");
CREATE INDEX "CalendarEventAttendee_email_idx" ON "CalendarEventAttendee"("email");
CREATE UNIQUE INDEX "CalendarWatchChannel_providerChannelId_key" ON "CalendarWatchChannel"("providerChannelId");
CREATE INDEX "CalendarWatchChannel_calendar_status_expires_idx" ON "CalendarWatchChannel"("calendarId", "status", "expiresAt");
CREATE INDEX "CalendarWatchChannel_integration_status_idx" ON "CalendarWatchChannel"("integrationId", "status");
CREATE UNIQUE INDEX "CalendarSyncJob_idempotencyKey_key" ON "CalendarSyncJob"("idempotencyKey");
CREATE INDEX "CalendarSyncJob_status_availableAt_idx" ON "CalendarSyncJob"("status", "availableAt");
CREATE INDEX "CalendarSyncJob_integration_status_idx" ON "CalendarSyncJob"("integrationId", "status");
CREATE INDEX "CalendarSyncJob_calendar_status_idx" ON "CalendarSyncJob"("calendarId", "status");
CREATE INDEX "CalendarSyncJob_event_status_idx" ON "CalendarSyncJob"("eventId", "status");
CREATE INDEX "CalendarSyncJob_leaseExpiresAt_idx" ON "CalendarSyncJob"("leaseExpiresAt");
CREATE UNIQUE INDEX "CalendarOAuthState_stateHash_key" ON "CalendarOAuthState"("stateHash");
CREATE INDEX "CalendarOAuthState_user_expires_idx" ON "CalendarOAuthState"("userId", "expiresAt");
CREATE INDEX "CalendarOAuthState_expires_consumed_idx" ON "CalendarOAuthState"("expiresAt", "consumedAt");

ALTER TABLE "Notification" ADD COLUMN "calendarEventId" TEXT;
CREATE INDEX "Notification_calendarEventId_idx" ON "Notification"("calendarEventId");

ALTER TABLE "CalendarIntegration" ADD CONSTRAINT "CalendarIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarSource" ADD CONSTRAINT "CalendarSource_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "CalendarIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "CalendarIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "CalendarSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_insuranceCaseId_fkey" FOREIGN KEY ("insuranceCaseId") REFERENCES "InsuranceCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CalendarEventAttendee" ADD CONSTRAINT "CalendarEventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarWatchChannel" ADD CONSTRAINT "CalendarWatchChannel_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "CalendarIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarWatchChannel" ADD CONSTRAINT "CalendarWatchChannel_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "CalendarSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarSyncJob" ADD CONSTRAINT "CalendarSyncJob_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "CalendarIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarSyncJob" ADD CONSTRAINT "CalendarSyncJob_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "CalendarSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarSyncJob" ADD CONSTRAINT "CalendarSyncJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CalendarOAuthState" ADD CONSTRAINT "CalendarOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
