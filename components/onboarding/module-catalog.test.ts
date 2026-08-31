import { describe, expect, it } from "vitest";
import {
  ONBOARDING_MODULE_CATALOG,
  onboardingModulesFor,
} from "./module-catalog";

describe("onboarding module catalog", () => {
  it("defines every supported module with an in-product destination", () => {
    expect(Object.keys(ONBOARDING_MODULE_CATALOG)).toEqual([
      "TODAY",
      "CALENDAR",
      "CRM",
      "MESSAGES",
      "POLICIES",
      "ILLUSTRATIONS",
      "COMMISSIONS",
      "JOURNEY",
      "TEAM",
      "INTEGRATIONS",
    ]);

    for (const definition of Object.values(ONBOARDING_MODULE_CATALOG)) {
      expect(definition.href).toMatch(/^\/agent(?:\/|$)/);
      expect(definition.description.PT.length).toBeGreaterThan(30);
      expect(definition.description.EN.length).toBeGreaterThan(30);
      expect(definition.outcome.PT.length).toBeGreaterThan(20);
      expect(definition.outcome.EN.length).toBeGreaterThan(20);
    }
  });

  it("preserves the server-required order without adding unavailable modules", () => {
    expect(onboardingModulesFor(["TODAY", "CRM", "TEAM"]).map(({ key }) => key)).toEqual([
      "TODAY",
      "CRM",
      "TEAM",
    ]);
  });

  it("returns localized module copy without changing routes or business keys", () => {
    expect(onboardingModulesFor(["TODAY", "CALENDAR"], "EN")).toMatchObject([
      { key: "TODAY", title: "Today", href: "/agent" },
      { key: "CALENDAR", title: "Calendar", href: "/agent/calendar" },
    ]);
    expect(onboardingModulesFor(["TODAY", "CALENDAR"], "PT")).toMatchObject([
      { key: "TODAY", title: "Hoje", href: "/agent" },
      { key: "CALENDAR", title: "Agenda", href: "/agent/calendar" },
    ]);
  });
});
