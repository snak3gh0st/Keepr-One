-- Ausência é desligado: nenhuma linha existente passa a estar ligada por esta
-- migração, que é exatamente o padrão que o produto pediu.
ALTER TABLE "KBotContactPreference" ADD COLUMN "kbotEnabledAt" TIMESTAMP(3);
