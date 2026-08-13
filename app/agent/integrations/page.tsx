import Link from "next/link";
import { Shell } from "@/components/Shell";
import { getCurrentAgent } from "@/lib/agent-context";
import { prisma } from "@/lib/prisma";
import { getCalendarConnectionForUser } from "@/lib/calendar";
import { isGoogleCalendarConfigured } from "@/lib/calendar/google/env";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const agent = await getCurrentAgent();
  const [user, calendar] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId }, select: { name: true } }),
    getCalendarConnectionForUser(agent.userId),
  ]);
  const googleConfigured = isGoogleCalendarConfigured();

  return (
    <Shell role="AGENT" userName={user?.name ?? ""}>
      <div className="integration-hub">
        <header className="integration-hub-header keepr-noise">
          <p>Conexões da operação</p>
          <h1>Menos troca de tela.<br /><span>Mais continuidade.</span></h1>
          <p>Conecte as fontes que mantêm agenda, produção e atendimento atualizados.</p>
        </header>
        <div className="integration-card-grid">
          <article className="integration-product-card" data-connected={calendar?.status === "CONNECTED" || undefined}>
            <div className="integration-product-icon" aria-hidden="true">31</div>
            <div>
              <span>Agenda</span>
              <h2>Google Calendar</h2>
              <p>Compromissos, convites e reuniões conectados ao CRM.</p>
            </div>
            <div className="integration-product-state">
              <i />
              <span>{calendar?.status === "CONNECTED" ? `Conectado a ${calendar.providerEmail}` : calendar?.status === "RECONNECT_REQUIRED" ? "Reconexão necessária" : calendar?.status === "ERROR" ? "Sincronização pausada" : googleConfigured ? "Pronto para conectar" : "Configuração pendente"}</span>
            </div>
            <Link href="/agent/integrations/google-calendar">{calendar?.status === "CONNECTED" ? "Gerenciar conexão" : calendar?.status === "RECONNECT_REQUIRED" || calendar?.status === "ERROR" ? "Resolver conexão" : "Configurar agenda"}<span aria-hidden="true">↗</span></Link>
          </article>
          <article className="integration-product-card" data-connected>
            <div className="integration-product-icon integration-nl-icon" aria-hidden="true">NL</div>
            <div><span>Produção</span><h2>National Life</h2><p>Apólices, ilustrações e produção sincronizadas com a operação.</p></div>
            <div className="integration-product-state"><i /><span>Integração da carteira</span></div>
            <Link href="/agent/integrations/national-life">Abrir integração<span aria-hidden="true">↗</span></Link>
          </article>
        </div>
      </div>
    </Shell>
  );
}
