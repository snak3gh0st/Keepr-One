-- Fills Policy.premium and Policy.premiumMode from the carrier's commission
-- detail, which is already in the database.
--
--   psql -d lifeos -v ON_ERROR_STOP=1 -f national-life-backfill-premium-from-commissions.sql
--
-- Why here and not from the inforce grid: the inforce payload carries AAP and
-- AccumulatedCashValue as keys but leaves both empty on all 9614 rows, and the
-- per-policy detail page was measured not to carry premium at all (0 hits over
-- 40 page loads). The commission earning detail is the only per-policy premium
-- found in the portal, and it is already stored — this costs zero carrier
-- requests.
--
-- Coverage is partial by nature: commission detail covers policies that paid
-- commission, which is 2148 of 9614. The rest keep premium 0 with premiumMode
-- NULL, which the UI already reads as "not known" rather than "zero" via
-- premiumIsKnown().
--
-- The modal premium is stored as the carrier reports it, together with its
-- BillingFrequency. Annualising on write would erase the client's own choice:
-- $250 monthly and $250 annual are different policies, and only the pair
-- (amount, mode) says which one this is.
--
-- Idempotent: re-running recomputes from the same source and overwrites.

BEGIN;

WITH latest AS (
  -- One row per policy: the most recent transaction, because the modal premium
  -- in force is the one most recently billed. Ties break on the larger amount so
  -- the result is deterministic across runs.
  SELECT DISTINCT ON (r.raw::jsonb->>'PolicyNumber')
         r.raw::jsonb->>'PolicyNumber' AS policy_number,
         nullif(regexp_replace(r.raw::jsonb->>'PremiumAmt', '[^0-9.]', '', 'g'), '')::numeric AS premium,
         nullif(btrim(r.raw::jsonb->>'BillingFrequency'), '') AS mode
  FROM "NationalLifeReportRow" r
  WHERE r."gridKey" = 'COMMISSION_DETAIL_NLD_COMMISSION_EARNING'
    AND nullif(btrim(r.raw::jsonb->>'PolicyNumber'), '') IS NOT NULL
    AND nullif(regexp_replace(r.raw::jsonb->>'PremiumAmt', '[^0-9.]', '', 'g'), '') IS NOT NULL
  ORDER BY
    r.raw::jsonb->>'PolicyNumber',
    -- Carrier dates are MM/DD/YYYY strings; anything else sorts last rather
    -- than aborting the whole backfill.
    (CASE WHEN r.raw::jsonb->>'PaymentDate' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
          THEN to_date(r.raw::jsonb->>'PaymentDate', 'MM/DD/YYYY') END) DESC NULLS LAST,
    nullif(regexp_replace(r.raw::jsonb->>'PremiumAmt', '[^0-9.]', '', 'g'), '')::numeric DESC
)
UPDATE "Policy" p
SET premium = latest.premium,
    "premiumMode" = latest.mode
FROM latest
WHERE p."policyNumber" = latest.policy_number
  AND latest.premium > 0;

COMMIT;

-- What landed, so the run reports itself instead of being assumed:
SELECT count(*) AS policies_total,
       count(*) FILTER (WHERE premium > 0) AS with_premium,
       count(*) FILTER (WHERE "premiumMode" IS NOT NULL) AS with_mode
FROM "Policy";
