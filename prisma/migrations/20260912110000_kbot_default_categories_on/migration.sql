-- prisma/migrations/20260912110000_kbot_default_categories_on/migration.sql

-- As categorias passam a nascer ligadas, esperando o agente.
--
-- Liga apenas o que NUNCA foi decidido. `ON CONFLICT DO NOTHING` protege a tripla
-- ("agentId","category","language"), mas a decisão do agente é sobre a CATEGORIA:
-- a tela lê a categoria como ligada se qualquer idioma estiver ligado, as duas
-- server actions escrevem com `updateMany` sobre todos os idiomas, e o motor lê a
-- linha do idioma do próprio agente. Sem o `NOT EXISTS` abaixo, um agente cuja
-- única linha é PT desligada e cujo `user.language` é EN ganharia uma linha EN
-- ligada — um deploy desfazendo uma escolha de quem usa o produto.
--
-- `body` fica nulo de propósito: é o que diz ao motor que o K-Bot escreve a
-- primeira mensagem. `autoSend` fica falso: nada sai sem alguém ler.
INSERT INTO "KBotMessageTemplate" ("id", "agentId", "category", "language", "body", "enabled", "autoSend", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  a."id",
  c."category",
  -- `user.language` é o enum UserLanguage; `KBotMessageTemplate.language` é text.
  -- Sem o cast o INSERT falha com erro de tipo.
  u."language"::text,
  NULL,
  true,
  false,
  now(),
  now()
FROM "Agent" a
JOIN "user" u ON u."id" = a."userId"
CROSS JOIN (VALUES ('BIRTHDAY'), ('ANNUAL_REVIEW'), ('LAPSE_RECOVERY')) AS c("category")
WHERE a."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "KBotMessageTemplate" t
    WHERE t."agentId" = a."id" AND t."category" = c."category"
  )
ON CONFLICT ("agentId", "category", "language") DO NOTHING;
