import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatNumber } from "@/lib/i18n/format";

describe("localized formatting", () => {
  it("formats numbers and currency for the selected language", () => {
    expect(formatNumber(1234.5, "EN")).toBe("1,234.5");
    expect(formatNumber(1234.5, "PT")).toBe("1.234,5");
    expect(formatCurrency(1234.5, "EN")).toContain("1,234.50");
    expect(formatCurrency(1234.5, "PT")).toContain("1.234,50");
  });

  it("formats display dates without changing the underlying instant", () => {
    const value = "2026-08-31T16:00:00.000Z";
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    };
    expect(formatDate(value, "PT", options)).toMatch(/31 de agosto de 2026/i);
    expect(formatDate(value, "EN", options)).toMatch(/August 31, 2026/i);
  });
});
