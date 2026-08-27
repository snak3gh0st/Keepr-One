"use client";

import { createContext, useContext } from "react";
import type { TrialCountdownView } from "@/lib/trial-countdown";

export type AgentAccessView = {
  kind: "INDIVIDUAL" | "AGENCY_MEMBER" | "AGENCY_OWNER";
  agencyName: string | null;
  subscriptionStatus: string | null;
  canManageTeam: boolean;
  canInviteAgents: boolean;
  canViewTeamSubscriptions: boolean;
  canViewAgencyNationalLife: boolean;
  trial?: TrialCountdownView | null;
};

const AgentAccessContext = createContext<AgentAccessView | null>(null);

export function AgentAccessProvider({
  access,
  children,
}: {
  access: AgentAccessView;
  children: React.ReactNode;
}) {
  return (
    <AgentAccessContext.Provider value={access}>
      {children}
    </AgentAccessContext.Provider>
  );
}

/**
 * Nullable because Shell is shared by all portals and is rendered on its own
 * in component tests. A missing context must always behave as least privilege.
 */
export function useAgentAccessContext() {
  return useContext(AgentAccessContext);
}
