-- Tira o PDF do Foresight de dentro do Postgres.
--
-- Aditiva de propósito: `storageKey` entra nula e `bytes` passa a aceitar nulo.
-- Nada é apagado aqui. As linhas já gravadas continuam servindo pelo `bytes` até
-- o backfill movê-las, e o caminho de leitura entende os dois estados.
--
-- Derrubar a coluna `bytes` é uma migração separada, depois do backfill
-- verificado em produção.
ALTER TABLE "NationalLifeForesightDocument" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "NationalLifeForesightDocument" ALTER COLUMN "bytes" DROP NOT NULL;
