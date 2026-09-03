-- Preserve who actually started an Application even when the case is later
-- reassigned inside an agency. Historical rows remain unknown instead of being
-- attributed to the current assignee without evidence.
ALTER TABLE "Application" ADD COLUMN "createdByUserId" TEXT;

CREATE INDEX "Application_createdByUserId_idx" ON "Application"("createdByUserId");

ALTER TABLE "Application"
ADD CONSTRAINT "Application_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "user"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
