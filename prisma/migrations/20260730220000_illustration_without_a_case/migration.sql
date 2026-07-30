-- An illustration is pre-sale: the insured is a prospect with no case, and
-- often no client record either. Requiring a case made this table impossible to
-- write to, and it has stayed empty since it was created — so nothing here
-- rewrites existing rows.
ALTER TABLE "Illustration" ALTER COLUMN "caseId" DROP NOT NULL;

ALTER TABLE "Illustration" ADD COLUMN "clientId" TEXT;
ALTER TABLE "Illustration" ADD COLUMN "agentId" TEXT NOT NULL;
ALTER TABLE "Illustration" ADD COLUMN "insuredName" TEXT;
ALTER TABLE "Illustration" ADD COLUMN "insuredDateOfBirth" TIMESTAMP(3);

ALTER TABLE "Illustration" ADD CONSTRAINT "Illustration_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Illustration" ADD CONSTRAINT "Illustration_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Illustration_agentId_createdAt_idx" ON "Illustration"("agentId", "createdAt");
CREATE INDEX "Illustration_clientId_idx" ON "Illustration"("clientId");
