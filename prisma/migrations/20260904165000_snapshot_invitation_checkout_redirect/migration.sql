-- No backfill: legacy uncertain attempts must wait for their recorded expiry.
ALTER TABLE "AgencyInvitationCheckout" ADD COLUMN "checkoutRedirectFingerprint" TEXT;
