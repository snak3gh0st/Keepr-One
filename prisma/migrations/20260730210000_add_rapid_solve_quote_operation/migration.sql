-- The first browser job that is not a read of an existing case: a pre-sale
-- illustration for a prospect who has no Case row yet. `caseId` is already
-- nullable, so nothing else in the table changes.
ALTER TYPE "BrowserJobOperation" ADD VALUE 'GET_RAPID_SOLVE_QUOTE';
