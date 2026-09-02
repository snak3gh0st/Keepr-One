-- Persist the authenticated panel language so it follows the user across
-- browsers and devices. Existing users keep the historical Portuguese UI.
CREATE TYPE "UserLanguage" AS ENUM ('PT', 'EN');

ALTER TABLE "user"
ADD COLUMN "language" "UserLanguage" NOT NULL DEFAULT 'PT';
