-- The premium a client pays is meaningless without the mode it is paid in:
-- $250 monthly and $250 annual are different policies. The carrier reports both
-- (PremiumAmt and BillingFrequency on every commission transaction), so the
-- distinction is stored rather than collapsed by annualising on write.
ALTER TABLE "Policy" ADD COLUMN "premiumMode" TEXT;
