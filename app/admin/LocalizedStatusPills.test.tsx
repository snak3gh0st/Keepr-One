// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ language: "PT" as "PT" | "EN" }));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useI18n: () => ({
    copy: (portuguese: string, english: string) => mocks.language === "PT" ? portuguese : english,
  }),
}));

import { LocalizedImportStatusPill, LocalizedRolePill } from "./LocalizedStatusPills";

beforeEach(() => {
  mocks.language = "PT";
});

describe("localized admin status pills", () => {
  it("renders import and role labels in Portuguese", () => {
    render(
      <>
        <LocalizedImportStatusPill status="COMPLETED_WITH_ERRORS" />
        <LocalizedRolePill role="AGENT" />
      </>,
    );
    expect(screen.getByText("Concluído com erros")).toBeInTheDocument();
    expect(screen.getByText("Agente")).toBeInTheDocument();
  });

  it("renders import and role labels in English", () => {
    mocks.language = "EN";
    render(
      <>
        <LocalizedImportStatusPill status="COMPLETED_WITH_ERRORS" />
        <LocalizedRolePill role="AGENT" />
      </>,
    );
    expect(screen.getByText("Completed with errors")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });
});
