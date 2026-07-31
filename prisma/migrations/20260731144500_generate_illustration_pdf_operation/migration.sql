-- Rendering a stored case to PDF is a carrier browser job like the others: it
-- needs a live session, the single Chrome, and the same queue.
ALTER TYPE "BrowserJobOperation" ADD VALUE 'GENERATE_ILLUSTRATION_PDF';
