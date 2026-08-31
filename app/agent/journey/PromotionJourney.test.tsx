// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ language: "PT" as "PT" | "EN" }));

vi.mock("@gsap/react", () => ({ useGSAP: () => undefined }));
vi.mock("gsap", () => ({ default: { registerPlugin: vi.fn() } }));
vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: {} }));
vi.mock("@/components/i18n/LanguageProvider", () => ({
  useI18n: () => ({
    language: mocks.language,
    locale: mocks.language === "PT" ? "pt-BR" : "en-US",
    copy: (portuguese: string, english: string) => mocks.language === "PT" ? portuguese : english,
  }),
}));

import { PromotionJourney } from "./PromotionJourney";

const baseProps = {
  personalPc: 1_000,
  agencyPc: 2_000,
  canViewAgencyJourney: true,
  hasAgencyStructure: true,
  estimatedPersonalPc: 100,
  estimatedAgencyPc: 200,
  pendingPersonalPc: 50,
  pendingAgencyPc: 75,
  hasPromotionData: true,
  windowStart: "2025-09-01T00:00:00.000Z",
  windowEnd: "2026-08-31T00:00:00.000Z",
  highestAchievementRankId: null,
};

beforeEach(() => {
  mocks.language = "PT";
});

describe("PromotionJourney", () => {
  it("renders operational content in Portuguese", () => {
    render(<PromotionJourney {...baseProps} />);
    expect(screen.getByText("Jornada de promoção")).toBeInTheDocument();
    expect(screen.getByText("PC pessoais confirmados")).toBeInTheDocument();
    expect(screen.getByText("Como calculamos")).toBeInTheDocument();
  });

  it("renders operational content and accessibility labels in English", () => {
    mocks.language = "EN";
    render(<PromotionJourney {...baseProps} />);
    expect(screen.getByText("Promotion journey")).toBeInTheDocument();
    expect(screen.getByText("Confirmed personal PC")).toBeInTheDocument();
    expect(screen.getByText("How we calculate it")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View previous promotion" })).toBeInTheDocument();
  });
});
