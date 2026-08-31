import Link from "next/link";
import { Shell } from "@/components/Shell";
import { getCurrentAgent } from "@/lib/agent-context";
import { prisma } from "@/lib/prisma";
import { SchedulingSettings } from "./SchedulingSettings";

export const dynamic = "force-dynamic";

export default async function GoogleCalendarSchedulingPage() {
  const agent = await getCurrentAgent();
  const user = await prisma.user.findUnique({
    where: { id: agent.userId },
    select: { name: true },
  });

  return (
    <Shell role="AGENT" userName={user?.name ?? ""}>
      <div className="scheduling-settings-page">
        <header className="scheduling-page-heading">
          <div>
            <Link href="/agent/integrations/google-calendar" className="scheduling-back-link">
              <span aria-hidden="true">←</span> Google Agenda
            </Link>
            <h1>Link de agendamento</h1>
            <p>Configure a página que seus clientes usam para escolher um horário livre. Cada reserva confirmada entra no Google Agenda e envia o convite automaticamente.</p>
          </div>
        </header>
        <SchedulingSettings />
      </div>
    </Shell>
  );
}
