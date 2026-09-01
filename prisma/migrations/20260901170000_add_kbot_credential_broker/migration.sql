ALTER TABLE "AgentIntegrationCredential"
  ALTER COLUMN "keyVersion" DROP NOT NULL,
  ALTER COLUMN "algorithm" DROP NOT NULL,
  ALTER COLUMN "iv" DROP NOT NULL,
  ALTER COLUMN "ciphertext" DROP NOT NULL,
  ALTER COLUMN "authTag" DROP NOT NULL,
  ADD COLUMN "formatVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "encryptionProvider" TEXT NOT NULL DEFAULT 'LEGACY_LOCAL_AES',
  ADD COLUMN "encryptedPayload" TEXT,
  ADD COLUMN "autoLoginEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "consentedAt" TIMESTAMP(3),
  ADD COLUMN "lastLeasedAt" TIMESTAMP(3),
  ADD COLUMN "lastRejectedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

ALTER TABLE "NationalLifeConnectorDevice"
  ADD COLUMN "encryptionPublicKeyJwk" JSONB,
  ADD COLUMN "encryptionKeyThumbprint" TEXT;

CREATE UNIQUE INDEX "NationalLifeConnectorDevice_encryptionKeyThumbprint_key"
  ON "NationalLifeConnectorDevice"("encryptionKeyThumbprint");

ALTER TABLE "NationalLifeSyncRun"
  ADD COLUMN "authState" TEXT NOT NULL DEFAULT 'READY',
  ADD COLUMN "authEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "authRequiredAt" TIMESTAMP(3),
  ADD CONSTRAINT "NationalLifeSyncRun_authEpoch_nonnegative" CHECK ("authEpoch" >= 0);

ALTER TABLE "NationalLifeConnectorCommand"
  ADD COLUMN "authState" TEXT NOT NULL DEFAULT 'READY',
  ADD COLUMN "authEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "authRequiredAt" TIMESTAMP(3),
  ADD CONSTRAINT "NationalLifeConnectorCommand_authEpoch_nonnegative" CHECK ("authEpoch" >= 0);

CREATE TABLE "NationalLifeCredentialLease" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "operationKind" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "authEpoch" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ISSUED',
  "outcome" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "reportedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NationalLifeCredentialLease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NationalLifeCredentialLease_authEpoch_nonnegative" CHECK ("authEpoch" >= 0),
  CONSTRAINT "NationalLifeCredentialLease_expiry_after_issue" CHECK ("expiresAt" > "issuedAt")
);

CREATE UNIQUE INDEX "NationalLifeCredentialLease_deviceId_operationKind_operationId_authEpoch_key"
  ON "NationalLifeCredentialLease"("deviceId", "operationKind", "operationId", "authEpoch");
CREATE INDEX "NationalLifeCredentialLease_agentId_issuedAt_idx"
  ON "NationalLifeCredentialLease"("agentId", "issuedAt");
CREATE INDEX "NationalLifeCredentialLease_status_expiresAt_idx"
  ON "NationalLifeCredentialLease"("status", "expiresAt");

ALTER TABLE "NationalLifeCredentialLease"
  ADD CONSTRAINT "NationalLifeCredentialLease_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalLifeCredentialLease"
  ADD CONSTRAINT "NationalLifeCredentialLease_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "AgentIntegrationCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalLifeCredentialLease"
  ADD CONSTRAINT "NationalLifeCredentialLease_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "NationalLifeConnectorDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
