-- Scheduled messages wait for the agent by default. Turning a category on means
-- "prepare these"; this flag means "and send them without asking me", which is
-- a separate decision the agent makes for themselves.
ALTER TABLE "KBotMessageTemplate" ADD COLUMN "autoSend" BOOLEAN NOT NULL DEFAULT false;
