-- A legacy invitation has no intended type until acceptance. Keep its pending
-- 4,990 snapshot unchanged, but allow an atomic legacy Agency acceptance to
-- record the invited 8,990 price. This migration intentionally updates no rows
-- or subscriptions, so historical accepted billing remains untouched.
ALTER TABLE "AgencyInvitation"
  DROP CONSTRAINT "AgencyInvitation_plan_price";

ALTER TABLE "AgencyInvitation"
  ADD CONSTRAINT "AgencyInvitation_plan_price" CHECK (
    (
      "intendedType" = 'AGENT'
      AND "monthlyPriceCents" = 4990
    )
    OR (
      "intendedType" = 'AGENCY'
      AND (
        "monthlyPriceCents" = 8990
        OR (
          "status" <> 'PENDING'
          AND "monthlyPriceCents" = 9990
        )
      )
    )
    OR (
      "intendedType" IS NULL
      AND (
        "monthlyPriceCents" = 4990
        OR (
          "status" = 'ACCEPTED'
          AND "monthlyPriceCents" = 8990
        )
      )
    )
  );
