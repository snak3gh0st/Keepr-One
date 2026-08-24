ALTER TABLE "Policy" ALTER COLUMN "faceAmount" DROP NOT NULL;
ALTER TABLE "Policy" ADD COLUMN "sourceStatus" TEXT;

-- The CSV import satisfied the old NOT NULL with a placeholder. Those zeros are
-- not measurements: no in-force life policy has a face amount of zero. Narrowed
-- to National Life rows so a genuine zero from another source is left alone.
UPDATE "Policy"
SET "faceAmount" = NULL
WHERE "sourceProvider" = 'NATIONAL_LIFE' AND "faceAmount" = 0;
