-- prisma/migrations/20260912100000_kbot_template_body_optional/migration.sql

-- `body` deixa de ser obrigatório: uma categoria ligada sem texto significa que
-- o K-Bot escreve a mensagem, e o agente aprova lendo. Nenhuma linha existente
-- muda de valor — todas já têm texto.
ALTER TABLE "KBotMessageTemplate" ALTER COLUMN "body" DROP NOT NULL;
