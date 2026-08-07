-- Índices para as duas seleções de varredura que não tinham nenhum.
--
-- A varredura de recibos filtra por run em estado terminal parado há mais de 30
-- dias; a de pairings, por `expiresAt` ou `consumedAt` sozinhos. Os índices que
-- já existiam nessas tabelas começam por `agentId`, e nenhuma das duas varreduras
-- filtra por agente — elas varrem a tabela inteira.
--
-- Dois índices de uma coluna em Pairing, e não um composto: o predicado é um OR,
-- que o Postgres resolve com BitmapOr dos dois. Um composto
-- `(expiresAt, consumedAt)` só serviria ao primeiro ramo.
--
-- CONCURRENTLY não é usado de propósito: as três tabelas são pequenas hoje (a
-- que cresce de verdade é a de replay, que já tinha seu índice), e `migrate
-- deploy` roda em transação, onde CONCURRENTLY é proibido.
CREATE INDEX "NationalLifeSyncRun_state_updatedAt_idx" ON "NationalLifeSyncRun"("state", "updatedAt");
CREATE INDEX "NationalLifeConnectorPairing_expiresAt_idx" ON "NationalLifeConnectorPairing"("expiresAt");
CREATE INDEX "NationalLifeConnectorPairing_consumedAt_idx" ON "NationalLifeConnectorPairing"("consumedAt");
