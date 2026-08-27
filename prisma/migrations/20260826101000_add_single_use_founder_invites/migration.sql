ALTER TABLE "FounderEnrollment"
  ADD COLUMN "accessCodeHash" TEXT;

ALTER TABLE "FounderEnrollment"
  ADD CONSTRAINT "FounderEnrollment_accessCodeHash_format" CHECK (
    "accessCodeHash" IS NULL
    OR "accessCodeHash" ~ '^[a-f0-9]{64}$'
  );

CREATE UNIQUE INDEX "FounderEnrollment_accessCodeHash_key"
  ON "FounderEnrollment"("accessCodeHash");
