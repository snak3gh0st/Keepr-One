-- Invitation pricing was originally limited to the discounted member plan.
-- Typed agency invitations now offer the Agency plan, so migrate the inferred
-- historical rows and replace the old one-price constraint atomically.
ALTER TABLE "AgencyInvitation"
  DROP CONSTRAINT "AgencyInvitation_discounted_price";

UPDATE "AgencyInvitation"
SET "monthlyPriceCents" = CASE "intendedType"
  WHEN 'AGENCY' THEN 9990
  WHEN 'AGENT' THEN 4990
  ELSE "monthlyPriceCents"
END;

ALTER TABLE "AgencyInvitation"
  ADD CONSTRAINT "AgencyInvitation_plan_price" CHECK (
    (
      "intendedType" = 'AGENT'
      AND "monthlyPriceCents" = 4990
    )
    OR (
      "intendedType" = 'AGENCY'
      AND "monthlyPriceCents" = 9990
    )
    OR (
      "intendedType" IS NULL
      AND "monthlyPriceCents" = 4990
    )
  );
