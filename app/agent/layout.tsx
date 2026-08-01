import { AgentPromotionProvider } from "@/components/AgentPromotionContext";
import { getCurrentAgent } from "@/lib/agent-context";
import { getAgentPromotionSnapshot } from "@/lib/agent-promotion";

export const dynamic = "force-dynamic";

export default async function AgentLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const agent = await getCurrentAgent();
  const promotion = await getAgentPromotionSnapshot(agent.id);

  return (
    <AgentPromotionProvider initialIdentity={promotion.identity}>
      {children}
    </AgentPromotionProvider>
  );
}
