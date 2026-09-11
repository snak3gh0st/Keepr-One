-- prisma/migrations/20260912110000_kbot_default_categories_on/migration.sql

-- As categorias passam a nascer ligadas, esperando o agente.
--
-- Liga apenas o que NUNCA foi decidido: `ON CONFLICT DO NOTHING` garante que uma
-- categoria que algum agente desligou continue desligada. Um deploy não pode
-- desfazer uma escolha de quem usa o produto.
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
ON CONFLICT ("agentId", "category", "language") DO NOTHING;
