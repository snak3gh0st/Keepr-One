"use client";

import { useI18n } from "@/components/i18n/LanguageProvider";

export function ContextPanelStatus() {
  const { copy } = useI18n();

  return (
    <span>
      <i />
      {copy("Operação conectada", "Connected operation")}
    </span>
  );
}
