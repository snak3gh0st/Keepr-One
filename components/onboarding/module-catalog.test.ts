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
      expect(definition.description.length).toBeGreaterThan(30);
      expect(definition.outcome.length).toBeGreaterThan(20);
    }
  });

  it("preserves the server-required order without adding unavailable modules", () => {
    expect(onboardingModulesFor(["TODAY", "CRM", "TEAM"]).map(({ key }) => key)).toEqual([
      "TODAY",
      "CRM",
      "TEAM",
    ]);
  });
});
