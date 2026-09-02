import { describe, expect, it } from "vitest";
import {
  localizedCrmStageName,
  localizedCrmTimelineBody,
  localizedCrmTimelineTitle,
} from "./i18n";

describe("localizedCrmStageName", () => {
  it("translates system stages and preserves custom names", () => {
    const english = (_portuguese: string, value: string) => value;

    expect(localizedCrmStageName(english, {
      name: "Nome antigo no banco",
      systemKey: "FIRST_MEETING_SCHEDULED",
    })).toBe("First Meeting Scheduled");
    expect(localizedCrmStageName(english, {
      name: "Minha etapa personalizada",
      systemKey: null,
    })).toBe("Minha etapa personalizada");
  });

  it("localizes standard stages in persisted timeline copy without changing custom names", () => {
    const english = (_portuguese: string, value: string, values?: Record<string, string | number>) =>
      value.replace(/\{(\w+)\}/g, (_match, key: string) => String(values?.[key] ?? `{${key}}`));

    expect(localizedCrmTimelineTitle(
      english,
      "CRM_STAGE_CHANGED",
      "Lead movido para Novo Lead",
    )).toBe("Lead moved to New Lead");
    expect(localizedCrmTimelineBody(
      english,
      "CRM_STAGE_CHANGED",
      "De Minha triagem para Aplicação por avanço técnico.",
    )).toBe("From Minha triagem to Application due to workflow progress.");
    expect(localizedCrmTimelineTitle(
      english,
      "FOLLOW_UP_RESCHEDULED",
      "Follow-up reagendado",
    )).toBe("Follow-up rescheduled");
    expect(localizedCrmTimelineBody(
      english,
      "FOLLOW_UP_RESCHEDULED",
      "De 20/08/2026 às 09:30 para 22/08/2026 às 14:00.",
    )).toBe("From 08/20/2026 at 09:30 to 08/22/2026 at 14:00.");
  });
});
