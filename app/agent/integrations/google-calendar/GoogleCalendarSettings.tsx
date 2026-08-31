"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/components/i18n/LanguageProvider";

export function GoogleCalendarSettings({
  status,
  email,
  calendars,
  lastSyncAt,
  configured,
}: {
  status: "CONNECTED" | "SYNCING" | "RECONNECT_REQUIRED" | "ERROR" | "DISCONNECTED";
  email: string | null;
  calendars: Array<{ id: string; name: string; visible: boolean; isDefault: boolean; color: string; canWrite: boolean; syncStatus: "SYNCED" | "PENDING" | "PROCESSING" | "ERROR" }>;
  lastSyncAt: string | null;
  configured: boolean;
}) {
  const { copy, locale } = useI18n();
  const [disconnecting, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const connected = status === "CONNECTED" || status === "SYNCING";
  const reconnectRequired = status === "RECONNECT_REQUIRED";
  const failed = status === "ERROR";
  const syncing = status === "SYNCING" || (connected && calendars.some((calendar) => calendar.syncStatus === "PENDING" || calendar.syncStatus === "PROCESSING"));
  const sourceFailed = connected && calendars.some((calendar) => calendar.syncStatus === "ERROR");
  const authorizeHref = "/api/agent/integrations/google-calendar/authorize?returnTo=/agent/integrations/google-calendar";
  const stateLabel = sourceFailed
    ? copy("Sincronização parcial", "Partial sync")
    : syncing
      ? copy("Sincronizando", "Syncing")
      : connected
        ? copy("Conexão ativa", "Active connection")
        : reconnectRequired
          ? copy("Ação necessária", "Action required")
          : failed
            ? copy("Sincronização pausada", "Sync paused")
            : configured
              ? copy("Pronto para conectar", "Ready to connect")
              : copy("Configuração pendente", "Configuration pending");
  const connectionCopy = sourceFailed
    ? copy("Um calendário não concluiu a atualização. Tente renovar a conexão para retomar a leitura.", "One calendar did not finish updating. Renew the connection to resume reading it.")
    : syncing
      ? copy("Estamos trazendo as alterações mais recentes. Você já pode continuar usando a Keepr One.", "We're bringing in the latest changes. You can keep using Keepr One.")
      : connected
        ? copy("Os calendários selecionados aparecem na Agenda Keepr One.", "Selected calendars appear in the Keepr One Calendar.")
        : reconnectRequired
          ? copy("A autorização expirou. Reconecte para retomar a sincronização sem perder seus vínculos.", "Authorization expired. Reconnect to resume syncing without losing your links.")
          : failed
            ? copy("O Google não respondeu como esperado. Reconecte a conta para restaurar a agenda.", "Google did not respond as expected. Reconnect the account to restore the calendar.")
            : copy("Veja compromissos do Google e do CRM no mesmo lugar, crie links do Meet e mantenha cada reunião ligada ao atendimento certo.", "See Google and CRM appointments in one place, create Meet links, and keep every meeting connected to the right case.");

  function disconnect() {
    if (!window.confirm(copy("Desconectar o Google Calendar? Seus eventos importados deixarão de ser atualizados.", "Disconnect Google Calendar? Your imported events will stop updating."))) return;
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/agent/integrations/google-calendar/disconnect", { method: "POST" });
        if (response.ok) window.location.assign("/agent/integrations/google-calendar?googleCalendar=disconnected");
        else setError(copy("Não foi possível desconectar agora.", "We couldn't disconnect right now."));
      } catch {
        setError(copy("Não foi possível desconectar agora.", "We couldn't disconnect right now."));
      }
    });
  }

  return (
    <div className="google-calendar-settings">
      {error ? <p className="calendar-inline-alert" role="alert">{error}</p> : null}
      {reconnectRequired || failed || sourceFailed ? <section className="google-calendar-recovery" role="status"><div><strong>{reconnectRequired ? copy("Sua agenda está segura na Keepr One.", "Your calendar is safe in Keepr One.") : sourceFailed ? copy("O restante da agenda continua disponível.", "The rest of your calendar remains available.") : copy("A sincronização precisa de atenção.", "Sync needs attention.")}</strong><p>{reconnectRequired ? copy("Nenhum dado local foi apagado. A nova autorização permite continuar exatamente de onde parou.", "No local data was deleted. A new authorization lets you continue exactly where you left off.") : sourceFailed ? copy("Tente novamente para atualizar o calendário que falhou, sem duplicar os compromissos já importados.", "Try again to update the calendar that failed without duplicating imported appointments.") : copy("Reconectar renova a autorização e reinicia a leitura dos calendários selecionados.", "Reconnecting renews authorization and restarts the selected calendars.")}</p></div>{configured ? <a href={authorizeHref}>{sourceFailed ? copy("Tentar novamente", "Try again") : copy("Reconectar agora", "Reconnect now")} <span aria-hidden="true">→</span></a> : null}</section> : null}
      <div className="google-calendar-settings-grid" data-connected={connected || undefined}>
        <section className="google-calendar-identity" data-connected={connected || undefined} data-state={sourceFailed || reconnectRequired || failed ? "attention" : syncing ? "syncing" : connected ? "connected" : "idle"}>
          <div className="google-calendar-identity-top">
            <div className="google-calendar-mark" aria-hidden="true"><span>31</span></div>
            <span className="google-calendar-state" role="status"><i aria-hidden="true" />{stateLabel}</span>
          </div>
          <div className="google-calendar-identity-copy">
            <span>{copy("Conexão individual", "Individual connection")}</span>
            <h2>{email ?? (connected ? "Google Calendar" : copy("Conecte sua agenda Google", "Connect your Google Calendar"))}</h2>
            <p>{connectionCopy}</p>
          </div>
          <div className="google-calendar-identity-action">
            {connected && !sourceFailed ? <><a href="/agent/integrations/google-calendar/scheduling">{copy("Configurar link de agendamento", "Configure scheduling link")} <span aria-hidden="true">→</span></a><button type="button" onClick={disconnect} disabled={disconnecting}>{disconnecting ? copy("Desconectando…", "Disconnecting…") : copy("Desconectar conta", "Disconnect account")}</button></> : configured ? <a href={authorizeHref}>{reconnectRequired || failed ? copy("Reconectar Google", "Reconnect Google") : sourceFailed ? copy("Tentar novamente", "Try again") : copy("Conectar Google Calendar", "Connect Google Calendar")} <span aria-hidden="true">↗</span></a> : <div className="google-calendar-environment-note" role="status"><strong>{copy("Configuração do ambiente pendente", "Environment configuration pending")}</strong><span>{copy("Adicione as credenciais do Google para liberar a conexão.", "Add Google credentials to enable the connection.")}</span></div>}
          </div>
          <footer className="google-calendar-identity-footer">
            <span><small>{copy("Privacidade", "Privacy")}</small><strong>{copy("Conta e agenda individuais", "Individual account and calendar")}</strong></span>
            <span><small>{copy("Segurança", "Security")}</small><strong>{copy("Tokens criptografados", "Encrypted tokens")}</strong></span>
          </footer>
        </section>
        {connected ? (
        <section className="google-calendar-source-settings">
          <header><div><span>{copy("Calendários", "Calendars")}</span><h2>{copy("O que aparece na sua operação", "What appears in your operations")}</h2></div><a href="/agent/calendar">{copy("Abrir Agenda", "Open Calendar")} <span aria-hidden="true">→</span></a></header>
          {calendars.length > 0 ? <ul>{calendars.map((calendar) => <li key={calendar.id}><i style={{ background: calendar.color }} /><div><strong>{calendar.name}</strong><small>{calendar.syncStatus === "ERROR" ? copy("Falha ao sincronizar", "Sync failed") : calendar.syncStatus === "PENDING" || calendar.syncStatus === "PROCESSING" ? copy("Sincronizando…", "Syncing…") : calendar.isDefault ? copy("Padrão para novos compromissos", "Default for new appointments") : calendar.canWrite ? copy("Disponível para criar eventos", "Available for event creation") : copy("Somente leitura", "Read only")}</small></div><span>{calendar.visible ? copy("Visível", "Visible") : copy("Oculto", "Hidden")}</span></li>)}</ul> : <div className="google-calendar-source-empty"><strong>{copy("Preparando seus calendários", "Preparing your calendars")}</strong><p>{copy("Assim que o Google concluir a primeira leitura, suas agendas aparecerão aqui.", "Your calendars will appear here as soon as Google completes the first read.")}</p></div>}
          <footer><span>{copy("Última sincronização", "Last sync")}</span><strong>{lastSyncAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSyncAt)) : copy("Preparando primeira sincronização", "Preparing first sync")}</strong><p>{copy("Visibilidade e calendário padrão são alterados na barra lateral da Agenda.", "Visibility and the default calendar are changed in the Calendar sidebar.")}</p></footer>
        </section>
      ) : (
        <section className="google-calendar-benefits">
          <header><span>{copy("Dentro da operação", "Inside your operations")}</span><h2>{copy("Agenda, atendimento e histórico no mesmo fluxo.", "Calendar, service, and history in the same flow.")}</h2></header>
          <ul>
            <li><span className="google-calendar-benefit-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></svg></span><div><h3>{copy("Link de agendamento", "Scheduling link")}</h3><p>{copy("O cliente escolhe um horário livre sem acessar sua agenda.", "Clients choose an available time without accessing your calendar.")}</p></div></li>
            <li><span className="google-calendar-benefit-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m15 10 5-3v10l-5-3v3H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h10v3Z" /></svg></span><div><h3>{copy("Meet e convites", "Meet and invitations")}</h3><p>{copy("Crie o link e convide o cliente durante o agendamento.", "Create the link and invite the client while scheduling.")}</p></div></li>
            <li><span className="google-calendar-benefit-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 11l2 2 4-5" /></svg></span><div><h3>{copy("Histórico do CRM", "CRM history")}</h3><p>{copy("Associe reuniões ao lead e preserve cada avanço da relação.", "Link meetings to the lead and preserve every step in the relationship.")}</p></div></li>
          </ul>
          <footer><span aria-hidden="true" />{copy("Você autoriza somente os escopos necessários. Os tokens ficam criptografados e nunca aparecem no navegador.", "You authorize only the required scopes. Tokens remain encrypted and never appear in the browser.")}</footer>
        </section>
      )}
      </div>
    </div>
  );
}
