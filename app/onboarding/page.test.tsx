// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockFounderAccessRequiredError extends Error {}
  return {
    getCurrentAgentOnboarding: vi.fn(),
    getNationalLifeLocalConnectorConfig: vi.fn(),
    isGoogleCalendarConfigured: vi.fn(),
    chatwootConfigFromEnv: vi.fn(),
    whatsappChannelModeFromEnv: vi.fn(),
    whatsappConfigFromEnv: vi.fn(),
    getServerI18n: vi.fn(),
    redirect: vi.fn((target: string) => {
      throw new Error(`REDIRECT:${target}`);
    }),
    experienceProps: vi.fn(),
    MockFounderAccessRequiredError,
  };
});

vi.mock("@/lib/agent-onboarding", () => ({
  getCurrentAgentOnboarding: mocks.getCurrentAgentOnboarding,
}));
vi.mock("@/lib/national-life/local-connector/config", () => ({
  getNationalLifeLocalConnectorConfig: mocks.getNationalLifeLocalConnectorConfig,
}));
vi.mock("@/lib/calendar/google/env", () => ({
  isGoogleCalendarConfigured: mocks.isGoogleCalendarConfigured,
}));
vi.mock("@/lib/messaging/chatwoot-config", () => ({
  chatwootConfigFromEnv: mocks.chatwootConfigFromEnv,
}));
vi.mock("@/lib/messaging/channel-mode", () => ({
  whatsappChannelModeFromEnv: mocks.whatsappChannelModeFromEnv,
}));
vi.mock("@/lib/messaging/whatsapp-config", () => ({
  whatsappConfigFromEnv: mocks.whatsappConfigFromEnv,
}));
vi.mock("@/lib/founder-access", () => ({
  FounderAccessRequiredError: mocks.MockFounderAccessRequiredError,
}));
vi.mock("@/lib/i18n/server", () => ({
  getServerI18n: mocks.getServerI18n,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/onboarding/OnboardingExperience", () => ({
  OnboardingExperience: (props: unknown) => {
    mocks.experienceProps(props);
    return <div>Experiência de onboarding</div>;
  },
}));

import OnboardingPage, { generateMetadata } from "./page";

const PAGE_DATA = {
  onboarding: {
    id: "onboarding-1",
    agentId: "agent-1",
    status: "IN_PROGRESS",
    currentStep: "WELCOME",
  },
  profile: {
    name: "Ana",
    phone: "+14075550101",
    timeZone: "America/New_York",
    npn: "",
  },
  integrations: {
    nationalLife: "NOT_CONNECTED",
    calendarConnected: false,
    whatsappConnected: false,
  },
};

beforeEach(() => {
  mocks.getCurrentAgentOnboarding.mockResolvedValue(PAGE_DATA);
  mocks.getNationalLifeLocalConnectorConfig.mockReturnValue({ enabled: false });
  mocks.isGoogleCalendarConfigured.mockReturnValue(true);
  mocks.chatwootConfigFromEnv.mockReturnValue({
    baseUrl: "https://chat.example.com",
    platformToken: "secret",
  });
  mocks.whatsappChannelModeFromEnv.mockReturnValue("EVOLUTION");
  mocks.whatsappConfigFromEnv.mockReturnValue({
    baseUrl: "https://wa.example.com",
    apiKey: "secret",
  });
  mocks.getServerI18n.mockResolvedValue({
    language: "PT",
    copy: (portuguese: string) => portuguese,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OnboardingPage", () => {
  it("localizes private-page metadata from the persisted server language", async () => {
    mocks.getServerI18n.mockResolvedValue({
      language: "EN",
      copy: (_portuguese: string, english: string) => english,
    });

    await expect(generateMetadata()).resolves.toMatchObject({
      title: "Set up your access",
      description: expect.stringContaining("Confirm your details"),
      robots: { index: false, follow: false },
    });
  });

  it("routes an expired founder to the subscription boundary instead of returning 500", async () => {
    mocks.getCurrentAgentOnboarding.mockRejectedValue(
      new mocks.MockFounderAccessRequiredError(),
    );

    await expect(OnboardingPage()).rejects.toThrow("REDIRECT:/founders/expired");
    expect(mocks.redirect).toHaveBeenCalledWith("/founders/expired");
  });

  it.each([
    { ...PAGE_DATA, onboarding: null },
    { ...PAGE_DATA, onboarding: { ...PAGE_DATA.onboarding, status: "COMPLETED" } },
  ])("routes legacy and completed accounts into the agent portal", async (data) => {
    mocks.getCurrentAgentOnboarding.mockResolvedValue(data);

    await expect(OnboardingPage()).rejects.toThrow("REDIRECT:/agent");
    expect(mocks.redirect).toHaveBeenCalledWith("/agent");
  });

  it("offers configured WhatsApp to a new account before any inbox row exists", async () => {
    render(await OnboardingPage());

    expect(screen.getByText("Experiência de onboarding")).toBeVisible();
    expect(mocks.experienceProps).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsapp: { available: true, mode: "EVOLUTION" },
      }),
    );
  });
});
