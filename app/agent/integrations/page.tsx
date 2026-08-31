import Link from "next/link";
import { Shell } from "@/components/Shell";
import { getCurrentAgent } from "@/lib/agent-context";
import { prisma } from "@/lib/prisma";
import { getCalendarConnectionForUser } from "@/lib/calendar";
import { isGoogleCalendarConfigured } from "@/lib/calendar/google/env";
import { getServerI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { copy } = await getServerI18n();
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
          <p>{copy("Conexões da operação", "Operations connections")}</p>
          <h1>{copy("Menos troca de tela.", "Fewer tabs to switch.")}<br /><span>{copy("Mais continuidade.", "More continuity.")}</span></h1>
          <p>{copy("Conecte as fontes que mantêm agenda, produção e atendimento atualizados.", "Connect the sources that keep your calendar, production, and client service up to date.")}</p>
        </header>
        <div className="integration-card-grid">
          <article className="integration-product-card" data-connected={calendar?.status === "CONNECTED" || undefined}>
            <div className="integration-product-icon" aria-hidden="true">31</div>
            <div>
              <span>{copy("Agenda e reservas", "Calendar and bookings")}</span>
              <h2>{copy("Google Agenda", "Google Calendar")}</h2>
              <p>{copy("Sincronize compromissos e publique um link para clientes escolherem data e horário.", "Sync appointments and publish a link so clients can choose a date and time.")}</p>
            </div>
            <div className="integration-product-state">
              <i />
              <span>{calendar?.status === "CONNECTED" ? copy("Conectado a {email}", "Connected to {email}", { email: calendar.providerEmail }) : calendar?.status === "RECONNECT_REQUIRED" ? copy("Reconexão necessária", "Reconnection required") : calendar?.status === "ERROR" ? copy("Sincronização pausada", "Sync paused") : googleConfigured ? copy("Pronto para conectar", "Ready to connect") : copy("Configuração pendente", "Configuration pending")}</span>
            </div>
            <Link href="/agent/integrations/google-calendar">{calendar?.status === "CONNECTED" ? copy("Gerenciar agenda e link", "Manage calendar and link") : calendar?.status === "RECONNECT_REQUIRED" || calendar?.status === "ERROR" ? copy("Resolver conexão", "Fix connection") : copy("Ativar Google Agenda", "Enable Google Calendar")}<span aria-hidden="true">↗</span></Link>
          </article>
          <article className="integration-product-card" data-connected>
            <div className="integration-product-icon integration-nl-icon" aria-hidden="true">NL</div>
            <div><span>{copy("Produção", "Production")}</span><h2>National Life</h2><p>{copy("Apólices, ilustrações e produção sincronizadas com a operação.", "Policies, illustrations, and production synced with your operations.")}</p></div>
            <div className="integration-product-state"><i /><span>{copy("Integração da carteira", "Portfolio integration")}</span></div>
            <Link href="/agent/integrations/national-life">{copy("Abrir integração", "Open integration")}<span aria-hidden="true">↗</span></Link>
          </article>
        </div>
      </div>
    </Shell>
  );
}
