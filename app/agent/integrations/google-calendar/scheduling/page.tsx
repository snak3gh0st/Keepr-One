import Link from "next/link";
import { Shell } from "@/components/Shell";
import { getCurrentAgent } from "@/lib/agent-context";
import { prisma } from "@/lib/prisma";
import { SchedulingSettings } from "./SchedulingSettings";
import { getServerI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function GoogleCalendarSchedulingPage() {
  const { copy } = await getServerI18n();
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
              <span aria-hidden="true">←</span> {copy("Google Agenda", "Google Calendar")}
            </Link>
            <h1>{copy("Link de agendamento", "Scheduling link")}</h1>
            <p>{copy("Configure a página que seus clientes usam para escolher um horário livre. Cada reserva confirmada entra no Google Agenda e envia o convite automaticamente.", "Configure the page your clients use to choose an available time. Each confirmed booking is added to Google Calendar and sends the invitation automatically.")}</p>
          </div>
        </header>
        <SchedulingSettings />
      </div>
    </Shell>
  );
}
