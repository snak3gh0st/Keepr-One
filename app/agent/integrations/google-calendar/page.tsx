import Link from "next/link";
import { Shell } from "@/components/Shell";
import { PageHeader } from "@/components/PageHeader";
import { getCurrentAgent } from "@/lib/agent-context";
import { prisma } from "@/lib/prisma";
import { getCalendarConnectionForUser } from "@/lib/calendar";
import { isGoogleCalendarConfigured } from "@/lib/calendar/google/env";
import { mapDomainCalendarConnectionToUi } from "@/components/calendar/server-adapter";
import { GoogleCalendarSettings } from "./GoogleCalendarSettings";

export const dynamic = "force-dynamic";

export default async function GoogleCalendarIntegrationPage() {
  const agent = await getCurrentAgent();
  const [user, domainConnection] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId }, select: { name: true } }),
    getCalendarConnectionForUser(agent.userId),
  ]);
  const mapped = mapDomainCalendarConnectionToUi(domainConnection);
  return (
    <Shell role="AGENT" userName={user?.name ?? ""}>
      <div className="google-calendar-page">
        <PageHeader
          title="Google Calendar"
          eyebrow="Integrações · Agenda"
          description="Reuniões, compromissos e Google Meet dentro da operação — vinculados aos leads e ao histórico do CRM."
        >
          <Link href="/agent/integrations" className="module-detail-back">
            <span className="module-detail-back-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none">
                <path d="m12.5 5-5 5 5 5" />
              </svg>
            </span>
            Voltar para Integrações
          </Link>
        </PageHeader>
        <GoogleCalendarSettings status={mapped.connection.status === "NOT_CONFIGURED" ? "DISCONNECTED" : mapped.connection.status} email={mapped.connection.email} calendars={mapped.calendars} lastSyncAt={mapped.connection.lastSyncAt} configured={isGoogleCalendarConfigured()} />
      </div>
    </Shell>
  );
}
