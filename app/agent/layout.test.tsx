// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getCurrentAgent: vi.fn(),
  getAgentAccessForAgent: vi.fn(),
  resolveFounderAccessForAgent: vi.fn(),
  getAgentPromotionSnapshot: vi.fn(),
  buildTrialCountdownView: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
}));

vi.mock("@/lib/i18n/server", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/lib/agent-context", () => ({
  getCurrentAgent: mocks.getCurrentAgent,
}));
vi.mock("@/lib/agent-access", () => ({
  getAgentAccessForAgent: mocks.getAgentAccessForAgent,
}));
vi.mock("@/lib/agent-promotion", () => ({
  getAgentPromotionSnapshot: mocks.getAgentPromotionSnapshot,
}));
vi.mock("@/lib/founder-access", () => ({
  FounderAccessRequiredError: class FounderAccessRequiredError extends Error {},
  resolveFounderAccessForAgent: mocks.resolveFounderAccessForAgent,
}));
vi.mock("@/lib/agent-onboarding-gate", () => ({
  AgentOnboardingRequiredError: class AgentOnboardingRequiredError extends Error {},
}));
vi.mock("@/lib/trial-countdown", () => ({
  buildTrialCountdownView: mocks.buildTrialCountdownView,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/AgentAccessContext", () => ({
  AgentAccessProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/AgentPromotionContext", () => ({
  AgentPromotionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AgentLayout from "./layout";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({
    user: { id: "agent-user", role: "AGENT" },
    session: { impersonatedBy: null },
  });
  mocks.getCurrentAgent.mockResolvedValue({ id: "agent-1" });
  mocks.getAgentAccessForAgent.mockResolvedValue({
    kind: "INDIVIDUAL",
    agencyName: null,
    subscriptionStatus: "ACTIVE",
    canManageTeam: false,
    canInviteAgents: false,
    canViewTeamSubscriptions: false,
    canViewAgencyNationalLife: false,
    enabledModules: null,
  });
  mocks.resolveFounderAccessForAgent.mockResolvedValue({});
  mocks.getAgentPromotionSnapshot.mockResolvedValue(null);
  mocks.buildTrialCountdownView.mockReturnValue(null);
});

afterEach(cleanup);

describe("AgentLayout", () => {
  it("sends a direct administrator session to user management", async () => {
    mocks.getCurrentSession.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
      session: { impersonatedBy: null },
    });

    await expect(AgentLayout({ children: <div>Agent portal</div> })).rejects.toThrow(
      "REDIRECT:/admin/users",
    );

    expect(mocks.redirect).toHaveBeenCalledWith("/admin/users");
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled();
  });

  it("continues rendering the portal for an agent session", async () => {
    render(await AgentLayout({ children: <div>Agent portal</div> }));

    expect(screen.getByText("Agent portal")).toBeVisible();
    expect(mocks.getCurrentAgent).toHaveBeenCalledOnce();
  });
});
