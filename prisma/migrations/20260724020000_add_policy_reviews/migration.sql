-- CreateTable: annual policy reviews (schedule → complete → auto-reschedule next year).
CREATE TABLE "PolicyReview" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PolicyReview_policyId_idx" ON "PolicyReview"("policyId");
CREATE INDEX "PolicyReview_dueAt_idx" ON "PolicyReview"("dueAt");

ALTER TABLE "PolicyReview" ADD CONSTRAINT "PolicyReview_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
