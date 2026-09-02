CREATE TYPE "AgencyInvitationCheckoutStatus" AS ENUM ('PENDING', 'FINALIZED');

CREATE TABLE "AgencyInvitationCheckout" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "agencyName" TEXT,
  "passwordHash" TEXT,
  "userId" TEXT,
  "plan" "PlatformPlan" NOT NULL,
  "inviterRole" "AgencyMembershipRole" NOT NULL,
  "status" "AgencyInvitationCheckoutStatus" NOT NULL DEFAULT 'PENDING',
  "unitAmountCents" INTEGER NOT NULL,
  "acceptedTermsAt" TIMESTAMP(3) NOT NULL,
  "checkoutExpiresAt" TIMESTAMP(3) NOT NULL,
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "stripeCheckoutSessionId" TEXT,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripeProductId" TEXT NOT NULL,
  "stripePriceId" TEXT NOT NULL,
  "platformSubscriptionId" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgencyInvitationCheckout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgencyInvitationCheckout_email_not_blank" CHECK (btrim("email") <> ''),
  CONSTRAINT "AgencyInvitationCheckout_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "AgencyInvitationCheckout_invited_plan" CHECK (
    "plan" IN ('AGENT_AGENCY_MEMBER', 'AGENCY')
  ),
  CONSTRAINT "AgencyInvitationCheckout_positive_amount" CHECK ("unitAmountCents" > 0),
  CONSTRAINT "AgencyInvitationCheckout_positive_attempt" CHECK ("attemptNumber" > 0),
  CONSTRAINT "AgencyInvitationCheckout_account_material" CHECK (
    "userId" IS NOT NULL OR ("passwordHash" IS NOT NULL AND btrim("passwordHash") <> '')
  ),
  CONSTRAINT "AgencyInvitationCheckout_lifecycle" CHECK (
    (
      "status" = 'PENDING'
      AND "finalizedAt" IS NULL
      AND "platformSubscriptionId" IS NULL
    )
    OR
    (
      "status" = 'FINALIZED'
      AND "finalizedAt" IS NOT NULL
      AND "userId" IS NOT NULL
      AND "stripeSubscriptionId" IS NOT NULL
      AND "platformSubscriptionId" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "AgencyInvitationCheckout_invitationId_key"
  ON "AgencyInvitationCheckout"("invitationId");
CREATE UNIQUE INDEX "AgencyInvitationCheckout_stripeCheckoutSessionId_key"
  ON "AgencyInvitationCheckout"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "AgencyInvitationCheckout_stripeSubscriptionId_key"
  ON "AgencyInvitationCheckout"("stripeSubscriptionId");
CREATE UNIQUE INDEX "AgencyInvitationCheckout_platformSubscriptionId_key"
  ON "AgencyInvitationCheckout"("platformSubscriptionId");
CREATE INDEX "AgencyInvitationCheckout_status_updatedAt_idx"
  ON "AgencyInvitationCheckout"("status", "updatedAt");
CREATE INDEX "AgencyInvitationCheckout_userId_idx"
  ON "AgencyInvitationCheckout"("userId");

ALTER TABLE "AgencyInvitationCheckout"
  ADD CONSTRAINT "AgencyInvitationCheckout_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "AgencyInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgencyInvitationCheckout"
  ADD CONSTRAINT "AgencyInvitationCheckout_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgencyInvitationCheckout"
  ADD CONSTRAINT "AgencyInvitationCheckout_platformSubscriptionId_fkey"
  FOREIGN KEY ("platformSubscriptionId") REFERENCES "PlatformSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
