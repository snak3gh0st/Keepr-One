// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  language: "PT" as "PT" | "EN",
  getCurrentAgent: vi.fn(),
  getPromotionSnapshot: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock("@/lib/agent-context", () => ({ getCurrentAgent: mocks.getCurrentAgent }));
vi.mock("@/lib/agent-promotion", () => ({ getAgentPromotionSnapshot: mocks.getPromotionSnapshot }));
vi.mock("@/lib/promotion-preview", () => ({ getLocalPromotionPreview: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser } } }));
vi.mock("@/lib/i18n/server", () => ({
  getServerI18n: async () => ({
    language: mocks.language,
    copy: (portuguese: string, english: string) => mocks.language === "PT" ? portuguese : english,
  }),
}));
vi.mock("@/components/Shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/PageHeader", () => ({
  PageHeader: ({
    title,
    eyebrow,
    description,
    children,
  }: {
    title: string;
    eyebrow?: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <header>
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </header>
  ),
}));
vi.mock("./PromotionJourney", () => ({ PromotionJourney: () => <div>promotion-journey</div> }));

import JourneyPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.language = "PT";
  mocks.getCurrentAgent.mockResolvedValue({ id: "agent-1", userId: "user-1" });
  mocks.findUser.mockResolvedValue({ name: "Ana" });
  mocks.getPromotionSnapshot.mockResolvedValue({
    personalPc: 0,
    agencyPc: 0,
    canViewAgencyJourney: false,
    hasAgencyStructure: false,
    mode: "individual",
    identity: { tone: "standard", rankTitle: null, jacket: null },
    loadError: false,
    estimatedPersonalPc: 0,
    estimatedAgencyPc: 0,
    pendingPersonalPc: 0,
    pendingAgencyPc: 0,
    hasPromotionData: false,
    windowStart: "2025-09-01T00:00:00.000Z",
    windowEnd: "2026-08-31T00:00:00.000Z",
    highestAchievement: null,
  });
});

describe("JourneyPage", () => {
  it("renders the journey shell in Portuguese", async () => {
    render(await JourneyPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Jornada" })).toBeInTheDocument();
    expect(screen.getByText("Caminho de promoção")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver extrato/i })).toBeInTheDocument();
  });

  it("renders the journey shell in English", async () => {
    mocks.language = "EN";
    render(await JourneyPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Journey" })).toBeInTheDocument();
    expect(screen.getByText("Promotion path")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View statement/i })).toBeInTheDocument();
  });
});
