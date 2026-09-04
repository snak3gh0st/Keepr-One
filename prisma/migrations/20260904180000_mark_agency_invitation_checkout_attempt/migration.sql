-- Existing rows and writes by an older binary receive a non-null marker, so
-- they are conservatively treated as potentially having reached Stripe. The
-- new implementation explicitly writes NULL before it calls Stripe.
ALTER TABLE "AgencyInvitationCheckout"
  ADD COLUMN "checkoutAttemptStartedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- PostgreSQL fills the default for existing rows. Keep this explicit backfill
-- so the invariant remains true if the database changes that implementation.
UPDATE "AgencyInvitationCheckout"
  SET "checkoutAttemptStartedAt" = CURRENT_TIMESTAMP
  WHERE "checkoutAttemptStartedAt" IS NULL;
