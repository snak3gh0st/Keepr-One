ALTER TABLE "PlatformSubscription"
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "stripeProductId" TEXT,
  ADD COLUMN "stripePriceId" TEXT;

CREATE UNIQUE INDEX "PlatformSubscription_stripeSubscriptionId_key"
  ON "PlatformSubscription"("stripeSubscriptionId");

CREATE INDEX "PlatformSubscription_stripeCustomerId_idx"
  ON "PlatformSubscription"("stripeCustomerId");

CREATE INDEX "PlatformSubscription_stripePriceId_idx"
  ON "PlatformSubscription"("stripePriceId");
