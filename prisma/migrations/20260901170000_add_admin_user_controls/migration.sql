ALTER TABLE "user"
ADD COLUMN "banned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "banReason" TEXT,
ADD COLUMN "banExpires" TIMESTAMP(3);

ALTER TABLE "session"
ADD COLUMN "impersonatedBy" TEXT;

CREATE INDEX "user_banned_idx" ON "user"("banned");

CREATE INDEX "AuditLog_entity_entityId_createdAt_idx"
ON "AuditLog"("entity", "entityId", "createdAt");

CREATE INDEX "AuditLog_userId_createdAt_idx"
ON "AuditLog"("userId", "createdAt");
