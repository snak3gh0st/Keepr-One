ALTER TABLE "Policy"
ALTER COLUMN "premium" DROP NOT NULL;

-- National Life rows previously used zero as a storage placeholder whenever
-- the carrier source omitted premium. The product already treats those zeros
-- as unknown; persist that truth directly now that the column is nullable.
UPDATE "Policy"
SET "premium" = NULL
WHERE "sourceProvider" = 'NATIONAL_LIFE'
  AND "premium" = 0;
