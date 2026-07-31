-- The carrier renders the illustration as a PDF and the National Life runtime
-- is a separate container from the web app, so a file written to that
-- container's disk is not readable by the page that has to serve it. Holding
-- the bytes keeps the document reachable without a shared volume.
ALTER TABLE "Illustration"
  ADD COLUMN "documentBytes" BYTEA,
  ADD COLUMN "documentMimeType" TEXT,
  ADD COLUMN "documentFetchedAt" TIMESTAMP(3);
