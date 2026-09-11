-- Redundant with KBotFollowupJob_agentId_phone_createdAt_idx, which already
-- leads on the same two columns: Postgres uses a composite index for queries on
-- any prefix of it. The extra index only cost writes on every job insert and
-- update, and it was added in the same change that introduced the shared
-- recency window without checking what was already there.
DROP INDEX IF EXISTS "KBotFollowupJob_agentId_phone_idx";
