import { AgentPromotionProvider } from "@/components/AgentPromotionContext";
import { AgentAccessProvider } from "@/components/AgentAccessContext";
import { getAgentAccessForAgent } from "@/lib/agent-access";
import { getCurrentAgent } from "@/lib/agent-context";
import { AgentOnboardingRequiredError } from "@/lib/agent-onboarding-gate";
import { getAgentPromotionSnapshot } from "@/lib/agent-promotion";
import {
  FounderAccessRequiredError,
  resolveFounderAccessForAgent,
} from "@/lib/founder-access";
import { getCurrentSession } from "@/lib/i18n/server";
import { buildTrialCountdownView } from "@/lib/trial-countdown";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentSession();
  if (session?.user.role === "ADMIN") {
    redirect("/admin/users");
  }

  let agent: Awaited<ReturnType<typeof getCurrentAgent>>;
  try {
    agent = await getCurrentAgent();
  } catch (error) {
    if (error instanceof AgentOnboardingRequiredError) {
      redirect("/onboarding");
    }
    if (error instanceof FounderAccessRequiredError) {
      redirect("/founders/expired");
    }
    throw error;
  }
  const now = new Date();
  // requireRole() already resolved this agent's founder access moments ago, and
  // the promotion snapshot below asks for the same commercial boundary. Both
  // helpers memoize per request, so calling them without an explicit timestamp
  // reuses that work instead of re-running roughly a dozen queries.
  const [access, platformAccess] = await Promise.all([
    getAgentAccessForAgent(agent.id),
    resolveFounderAccessForAgent(agent.id),
  ]);
  // The Journey surface was removed, but the promotion snapshot still feeds the
  // recognition identity (jacket tone) rendered in the shell header, so it is no
  // longer gated behind a module entitlement.
  const promotion = await getAgentPromotionSnapshot(agent.id);
  const trial = buildTrialCountdownView(platformAccess, now);

  return (
    <AgentAccessProvider
      access={{
        kind: access.kind,
        agencyName: access.agencyName,
        subscriptionStatus: access.subscriptionStatus,
        canManageTeam: access.canManageTeam,
        canInviteAgents: access.canInviteAgents,
        canViewTeamSubscriptions: access.canViewTeamSubscriptions,
        canViewAgencyNationalLife: access.canViewAgencyNationalLife,
        enabledModules: access.enabledModules,
        trial,
      }}
    >
      <AgentPromotionProvider initialIdentity={promotion?.identity ?? null}>
        {children}
      </AgentPromotionProvider>
    </AgentAccessProvider>
  );
}
