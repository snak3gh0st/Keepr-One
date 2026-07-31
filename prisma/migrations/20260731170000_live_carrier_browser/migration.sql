-- The browser the human logged in on is kept alive instead of released, so the
-- illustration tool's in-memory token survives between jobs. Nullable, and null
-- means "no live browser held" — which is exactly the behaviour that existed
-- before this column, so an unmigrated read path degrades to it rather than
-- breaking.
ALTER TABLE "AgentIntegrationSession" ADD COLUMN "liveSteelSessionId" TEXT;
