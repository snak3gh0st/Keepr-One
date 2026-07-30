-- Promotes the National Life inforce staging book into the domain tables, so the
-- whole app (policies, clients, dashboard) sees the real book instead of only the
-- integration's own page.
--
--   psql -d lifeos -v ON_ERROR_STOP=1 -f national-life-promote-inforce-to-domain.sql
--
-- Idempotent: clients are skipped when the agent already has that name, and
-- policies upsert on the carrier policy number.
--
-- KNOWN GAP: faceAmount and premium are written as 0. Policy requires both to be
-- non-null and the inforce grid carries neither — 0 of 9614 rows had AAP or cash
-- value, and only 1 matched a new-business case, so there is nowhere to read them
-- from yet. The figures are not lost: the untouched carrier payload stays in
-- NationalLifeInforcePolicy.raw. Any premium total in the UI will read $0 until a
-- source for them is found (likely the per-policy detail page, not yet probed).
--
-- Ran manually against production on 2026-07-30: 8643 clients, 9614 policies.
-- Turning this into a service plus a job is separate, still-pending work.

BEGIN;

-- Clients from the insured on each inforce policy, one per agent + name.
INSERT INTO "Client" (id, name, email, phone, "assignedAgentId", "createdAt")
SELECT gen_random_uuid()::text, x.name, x.email, x.phone, x."agentId", now()
FROM (
  SELECT DISTINCT ON (i."agentId", lower(i."insuredClientName"))
         i."agentId", i."insuredClientName" AS name,
         i."insuredEmail" AS email, i."insuredPhoneNumber" AS phone
  FROM "NationalLifeInforcePolicy" i
  WHERE i."insuredClientName" IS NOT NULL AND btrim(i."insuredClientName") <> ''
  ORDER BY i."agentId", lower(i."insuredClientName")
) x
WHERE NOT EXISTS (
  SELECT 1 FROM "Client" c
  WHERE c."assignedAgentId" = x."agentId" AND lower(c.name) = lower(x.name)
);

-- Policies keyed on the carrier policy number so a re-run updates in place.
-- faceAmount and premium are 0 because the inforce grid carries neither.
INSERT INTO "Policy" (
  id, "clientId", "agentId", carrier, product, "policyNumber",
  "faceAmount", premium, status, "effectiveDate",
  "sourceProvider", "sourceExternalId", "sourceUpdatedAt", "createdAt"
)
SELECT DISTINCT ON (i."policyNumber")
       gen_random_uuid()::text, c.id, i."agentId", 'National Life Group',
       coalesce(nullif(btrim(i."productName"), ''), nullif(btrim(i."productClass"), ''), 'Nao informado'),
       i."policyNumber",
       0, 0,
       (CASE
          WHEN i."policyStatus" ILIKE 'Pending Lapse%' THEN 'INFORCE'
          WHEN i."policyStatus" ILIKE 'Active%'        THEN 'INFORCE'
          WHEN i."policyStatus" ILIKE 'Issued%'        THEN 'INFORCE'
          WHEN i."policyStatus" ILIKE '%Lapse%'        THEN 'LAPSED'
          WHEN i."policyStatus" ILIKE 'Not Active%'    THEN 'CANCELLED'
          ELSE 'PENDING'
        END)::"PolicyStatus",
       CASE WHEN i."policyIssueDate" ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
            THEN to_date(i."policyIssueDate", 'MM/DD/YYYY') END,
       'NATIONAL_LIFE', i."policyNumber", i."fetchedAt", now()
FROM "NationalLifeInforcePolicy" i
JOIN "Client" c
  ON c."assignedAgentId" = i."agentId" AND lower(c.name) = lower(i."insuredClientName")
WHERE i."insuredClientName" IS NOT NULL AND btrim(i."insuredClientName") <> ''
ORDER BY i."policyNumber", i."fetchedAt" DESC
ON CONFLICT ("policyNumber") DO UPDATE SET
  status = EXCLUDED.status,
  product = EXCLUDED.product,
  "effectiveDate" = EXCLUDED."effectiveDate",
  "sourceProvider" = EXCLUDED."sourceProvider",
  "sourceExternalId" = EXCLUDED."sourceExternalId",
  "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt";

COMMIT;
