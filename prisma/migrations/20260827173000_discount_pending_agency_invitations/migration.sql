-- New agency invitations carry the same fixed USD 10 monthly discount as
-- invited-agent subscriptions. Historical agency invitations keep their
-- accepted/revoked/expired price snapshot for auditability.
ALTER TABLE "AgencyInvitation"
  DROP CONSTRAINT "AgencyInvitation_plan_price";

UPDATE "AgencyInvitation"
SET "monthlyPriceCents" = 8990
WHERE "intendedType" = 'AGENCY'
  AND "status" = 'PENDING';

ALTER TABLE "AgencyInvitation"
  ADD CONSTRAINT "AgencyInvitation_plan_price" CHECK (
    (
      "intendedType" = 'AGENT'
      AND "monthlyPriceCents" = 4990
    )
    OR (
      "intendedType" = 'AGENCY'
      AND (
        (
          "status" = 'PENDING'
          AND "monthlyPriceCents" = 8990
        )
        OR (
          "status" <> 'PENDING'
          AND "monthlyPriceCents" IN (8990, 9990)
        )
      )
    )
    OR (
      "intendedType" IS NULL
      AND "monthlyPriceCents" = 4990
    )
  );
