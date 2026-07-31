-- The illustration path (Foresight) sits behind the carrier's Auth0 tenant,
-- which was measured dying while the portal session stayed authenticated. Each
-- keep-alive tick that crosses the SSO jump records what it found here.
-- Nullable because a tick before this column existed, or one that never crossed
-- the jump, knows nothing — which is different from knowing it is unreachable.
ALTER TABLE "AgentIntegrationSession"
  ADD COLUMN "illustrationSsoReachable" BOOLEAN,
  ADD COLUMN "illustrationSsoCheckedAt" TIMESTAMP(3);
