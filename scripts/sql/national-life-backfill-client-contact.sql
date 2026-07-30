-- Fills Client.email, Client.phone and Client.dateOfBirth from carrier data
-- already in the database. Zero carrier requests.
--
--   psql -d lifeos -v ON_ERROR_STOP=1 -f national-life-backfill-client-contact.sql
--
-- Two sources, because the portal splits them:
--
--   * Contact — CLIENT_INTELLIGENCE, the service-call log. It is the only place
--     the portal exposes a client's email and phone: the inforce payload carries
--     InsuredEmail and InsuredPhoneNumber as keys but leaves both empty on all
--     9614 rows. Coverage is therefore partial by nature — the log only holds
--     clients who called. 1538 of 8824 clients match by name.
--
--   * Date of birth — the inforce book, which reports InsuredDOB on every row
--     and covers 8643 clients.
--
-- Existing values are never overwritten. A client whose contact was entered by a
-- human outranks a carrier row, and this script must be safe to re-run.
--
-- Matching is by lower(name) within the agent, the same key the promotion used.
-- That is fragile against spelling differences and it is what exists: the
-- carrier's CustomerName is the only handle these rows share with Client.

BEGIN;

-- Contact from the most recent service call that carries one.
WITH contact AS (
  SELECT DISTINCT ON (lower(btrim(r.raw::jsonb->>'CustomerName')))
         lower(btrim(r.raw::jsonb->>'CustomerName')) AS match_name,
         nullif(btrim(r.raw::jsonb->>'EmailAddress'), '') AS email,
         nullif(btrim(r.raw::jsonb->>'PhoneNumber'), '') AS phone
  FROM "NationalLifeReportRow" r
  WHERE r."gridKey" = 'CLIENT_INTELLIGENCE'
    AND nullif(btrim(r.raw::jsonb->>'CustomerName'), '') IS NOT NULL
    AND (nullif(btrim(r.raw::jsonb->>'EmailAddress'), '') IS NOT NULL
      OR nullif(btrim(r.raw::jsonb->>'PhoneNumber'), '') IS NOT NULL)
  ORDER BY lower(btrim(r.raw::jsonb->>'CustomerName')),
    -- Newest call first: a client who changed email should land on the current
    -- one. Unparseable dates sort last instead of aborting the backfill.
    (CASE WHEN r.raw::jsonb->>'CreatedDate' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
          THEN to_date(r.raw::jsonb->>'CreatedDate', 'MM/DD/YYYY') END) DESC NULLS LAST
)
UPDATE "Client" c
SET email = coalesce(nullif(btrim(c.email), ''), contact.email),
    phone = coalesce(nullif(btrim(c.phone), ''), contact.phone)
FROM contact
WHERE lower(btrim(c.name)) = contact.match_name
  AND (nullif(btrim(c.email), '') IS NULL OR nullif(btrim(c.phone), '') IS NULL);

-- Date of birth from the inforce book.
WITH dob AS (
  SELECT DISTINCT ON (i."agentId", lower(btrim(i."insuredClientName")))
         i."agentId",
         lower(btrim(i."insuredClientName")) AS match_name,
         to_date(i.raw::jsonb->>'InsuredDOB', 'MM/DD/YYYY') AS born
  FROM "NationalLifeInforcePolicy" i
  WHERE nullif(btrim(i."insuredClientName"), '') IS NOT NULL
    AND i.raw::jsonb->>'InsuredDOB' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
  ORDER BY i."agentId", lower(btrim(i."insuredClientName")), i."fetchedAt" DESC
)
UPDATE "Client" c
SET "dateOfBirth" = dob.born
FROM dob
WHERE c."assignedAgentId" = dob."agentId"
  AND lower(btrim(c.name)) = dob.match_name
  AND c."dateOfBirth" IS NULL
  -- A birth date in the future or before 1900 is a parse artefact, not a person.
  AND dob.born BETWEEN DATE '1900-01-01' AND CURRENT_DATE;

COMMIT;

SELECT count(*) AS clients,
       count(*) FILTER (WHERE nullif(btrim(email), '') IS NOT NULL) AS with_email,
       count(*) FILTER (WHERE nullif(btrim(phone), '') IS NOT NULL) AS with_phone,
       count(*) FILTER (WHERE "dateOfBirth" IS NOT NULL) AS with_dob
FROM "Client";
