-- Removes the synthetic demo seed so the book of business is only real carrier
-- data. Seed rows are identified by Policy."sourceProvider" IS NULL: every real
-- policy is written by the promotion with 'NATIONAL_LIFE'.
--
--   psql -d lifeos -v ON_ERROR_STOP=1 -f national-life-remove-demo-seed.sql
--
-- Deletes in dependency order because none of these foreign keys cascade.
-- Clients are only removed when nothing references them any more, so a client
-- that also owns a real policy survives.
BEGIN;

CREATE TEMP TABLE seed_policy_ids ON COMMIT DROP AS
SELECT id, "clientId" FROM "Policy" WHERE "sourceProvider" IS NULL;

DELETE FROM "CommissionRecord"      WHERE "policyId" IN (SELECT id FROM seed_policy_ids);
DELETE FROM "CommissionTransaction" WHERE "policyId" IN (SELECT id FROM seed_policy_ids);
DELETE FROM "PolicyDocument"        WHERE "policyId" IN (SELECT id FROM seed_policy_ids);
DELETE FROM "PolicyReview"          WHERE "policyId" IN (SELECT id FROM seed_policy_ids);
DELETE FROM "PolicySnapshot"        WHERE "policyId" IN (SELECT id FROM seed_policy_ids);
DELETE FROM "PolicyTransaction"     WHERE "policyId" IN (SELECT id FROM seed_policy_ids);

DELETE FROM "Policy" WHERE id IN (SELECT id FROM seed_policy_ids);

-- Clients left with nothing pointing at them.
DELETE FROM "Client" c
WHERE c.id IN (SELECT DISTINCT "clientId" FROM seed_policy_ids)
  AND NOT EXISTS (SELECT 1 FROM "Policy" p WHERE p."clientId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "InsuranceCase" i WHERE i."clientId" = c.id);

COMMIT;
