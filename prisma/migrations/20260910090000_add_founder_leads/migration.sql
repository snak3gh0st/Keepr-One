-- Leads remain separate from FounderEnrollment and do not start a trial.
CREATE TABLE "FounderLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FounderLead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FounderLead_email_key" ON "FounderLead"("email");
