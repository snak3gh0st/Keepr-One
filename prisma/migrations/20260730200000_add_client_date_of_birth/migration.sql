-- The carrier reports InsuredDOB on every inforce policy and it was being
-- discarded: 9614 of 9614 rows carry it, covering 8643 of 8824 clients. Stored
-- as a date so age and birthdays are computable rather than re-parsed from the
-- carrier's MM/DD/YYYY string at every call site.
ALTER TABLE "Client" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
