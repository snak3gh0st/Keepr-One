import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  localeFor,
  normalizeLanguage,
  languageCookieValue,
  resolveLanguagePreference,
} from "@/lib/i18n/config";
import { localize, translate } from "@/lib/i18n/catalog";

describe("i18n configuration", () => {
  it("accepts only supported persisted values", () => {
    expect(normalizeLanguage("PT")).toBe("PT");
    expect(normalizeLanguage("EN")).toBe("EN");
    expect(normalizeLanguage("en")).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(DEFAULT_LANGUAGE).toBe("PT");
  });

  it("maps languages to BCP 47 locales", () => {
    expect(localeFor("PT")).toBe("pt-BR");
    expect(localeFor("EN")).toBe("en-US");
  });

  it("gives the authenticated preference precedence over a stale cookie", () => {
    expect(resolveLanguagePreference("EN", "PT")).toBe("EN");
    expect(resolveLanguagePreference(undefined, "EN")).toBe("EN");
    expect(resolveLanguagePreference("invalid", "invalid")).toBe("PT");
  });

  it("creates a durable, host-only language cookie", () => {
    const value = languageCookieValue("EN");
    expect(value).toContain(`${LANGUAGE_COOKIE}=EN`);
    expect(value).toContain("Path=/");
    expect(value).toContain("SameSite=Lax");
    expect(value).not.toContain("Domain=");
  });

  it("translates keyed and inline copy with placeholders", () => {
    expect(translate("EN", "workspace.linkedAgency", { agency: "North Star" }))
      .toBe("Linked to North Star");
    expect(localize("PT", "Olá, {name}", "Hello, {name}", { name: "Ana" }))
      .toBe("Olá, Ana");
    expect(localize("EN", "Olá, {name}", "Hello, {name}", { name: "Ana" }))
      .toBe("Hello, Ana");
  });
});
