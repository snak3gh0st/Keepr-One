"use client";

import { useState, useTransition } from "react";

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
  const [disconnecting, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const connected = status === "CONNECTED" || status === "SYNCING";
  const reconnectRequired = status === "RECONNECT_REQUIRED";
  const failed = status === "ERROR";
  const syncing = status === "SYNCING" || (connected && calendars.some((calendar) => calendar.syncStatus === "PENDING" || calendar.syncStatus === "PROCESSING"));
  const sourceFailed = connected && calendars.some((calendar) => calendar.syncStatus === "ERROR");
  const authorizeHref = "/api/agent/integrations/google-calendar/authorize?returnTo=/agent/integrations/google-calendar";
  const stateLabel = sourceFailed
    ? "Sincronização parcial"
    : syncing
      ? "Sincronizando"
      : connected
        ? "Conexão ativa"
        : reconnectRequired
          ? "Ação necessária"
          : failed
            ? "Sincronização pausada"
            : configured
              ? "Pronto para conectar"
              : "Configuração pendente";
  const connectionCopy = sourceFailed
    ? "Um calendário não concluiu a atualização. Tente renovar a conexão para retomar a leitura."
    : syncing
      ? "Estamos trazendo as alterações mais recentes. Você já pode continuar usando a Keepr One."
      : connected
        ? "Os calendários selecionados aparecem na Agenda Keepr One."
        : reconnectRequired
          ? "A autorização expirou. Reconecte para retomar a sincronização sem perder seus vínculos."
          : failed
            ? "O Google não respondeu como esperado. Reconecte a conta para restaurar a agenda."
            : "Veja compromissos do Google e do CRM no mesmo lugar, crie links do Meet e mantenha cada reunião ligada ao atendimento certo.";

  function disconnect() {
    if (!window.confirm("Desconectar o Google Calendar? Seus eventos importados deixarão de ser atualizados.")) return;
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/agent/integrations/google-calendar/disconnect", { method: "POST" });
        if (response.ok) window.location.assign("/agent/integrations/google-calendar?googleCalendar=disconnected");
        else setError("Não foi possível desconectar agora.");
      } catch {
        setError("Não foi possível desconectar agora.");
      }
    });
  }

  return (
    <div className="google-calendar-settings">
      {error ? <p className="calendar-inline-alert" role="alert">{error}</p> : null}
      {reconnectRequired || failed || sourceFailed ? <section className="google-calendar-recovery" role="status"><div><strong>{reconnectRequired ? "Sua agenda está segura na Keepr One." : sourceFailed ? "O restante da agenda continua disponível." : "A sincronização precisa de atenção."}</strong><p>{reconnectRequired ? "Nenhum dado local foi apagado. A nova autorização permite continuar exatamente de onde parou." : sourceFailed ? "Tente novamente para atualizar o calendário que falhou, sem duplicar os compromissos já importados." : "Reconectar renova a autorização e reinicia a leitura dos calendários selecionados."}</p></div>{configured ? <a href={authorizeHref}>{sourceFailed ? "Tentar novamente" : "Reconectar agora"} <span aria-hidden="true">→</span></a> : null}</section> : null}
      <div className="google-calendar-settings-grid" data-connected={connected || undefined}>
        <section className="google-calendar-identity" data-connected={connected || undefined} data-state={sourceFailed || reconnectRequired || failed ? "attention" : syncing ? "syncing" : connected ? "connected" : "idle"}>
          <div className="google-calendar-identity-top">
            <div className="google-calendar-mark" aria-hidden="true"><span>31</span></div>
            <span className="google-calendar-state" role="status"><i aria-hidden="true" />{stateLabel}</span>
          </div>
          <div className="google-calendar-identity-copy">
            <span>Conexão individual</span>
            <h2>{email ?? (connected ? "Google Calendar" : "Conecte sua agenda Google")}</h2>
            <p>{connectionCopy}</p>
          </div>
          <div className="google-calendar-identity-action">
            {connected && !sourceFailed ? <><a href="/agent/integrations/google-calendar/scheduling">Configurar link de agendamento <span aria-hidden="true">→</span></a><button type="button" onClick={disconnect} disabled={disconnecting}>{disconnecting ? "Desconectando…" : "Desconectar conta"}</button></> : configured ? <a href={authorizeHref}>{reconnectRequired || failed ? "Reconectar Google" : sourceFailed ? "Tentar novamente" : "Conectar Google Calendar"} <span aria-hidden="true">↗</span></a> : <div className="google-calendar-environment-note" role="status"><strong>Configuração do ambiente pendente</strong><span>Adicione as credenciais do Google para liberar a conexão.</span></div>}
          </div>
          <footer className="google-calendar-identity-footer">
            <span><small>Privacidade</small><strong>Conta e agenda individuais</strong></span>
            <span><small>Segurança</small><strong>Tokens criptografados</strong></span>
          </footer>
        </section>
        {connected ? (
        <section className="google-calendar-source-settings">
          <header><div><span>Calendários</span><h2>O que aparece na sua operação</h2></div><a href="/agent/calendar">Abrir Agenda <span aria-hidden="true">→</span></a></header>
          {calendars.length > 0 ? <ul>{calendars.map((calendar) => <li key={calendar.id}><i style={{ background: calendar.color }} /><div><strong>{calendar.name}</strong><small>{calendar.syncStatus === "ERROR" ? "Falha ao sincronizar" : calendar.syncStatus === "PENDING" || calendar.syncStatus === "PROCESSING" ? "Sincronizando…" : calendar.isDefault ? "Padrão para novos compromissos" : calendar.canWrite ? "Disponível para criar eventos" : "Somente leitura"}</small></div><span>{calendar.visible ? "Visível" : "Oculto"}</span></li>)}</ul> : <div className="google-calendar-source-empty"><strong>Preparando seus calendários</strong><p>Assim que o Google concluir a primeira leitura, suas agendas aparecerão aqui.</p></div>}
          <footer><span>Última sincronização</span><strong>{lastSyncAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSyncAt)) : "Preparando primeira sincronização"}</strong><p>Visibilidade e calendário padrão são alterados na barra lateral da Agenda.</p></footer>
        </section>
      ) : (
        <section className="google-calendar-benefits">
          <header><span>Dentro da operação</span><h2>Agenda, atendimento e histórico no mesmo fluxo.</h2></header>
          <ul>
            <li><span className="google-calendar-benefit-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></svg></span><div><h3>Link de agendamento</h3><p>O cliente escolhe um horário livre sem acessar sua agenda.</p></div></li>
            <li><span className="google-calendar-benefit-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m15 10 5-3v10l-5-3v3H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h10v3Z" /></svg></span><div><h3>Meet e convites</h3><p>Crie o link e convide o cliente durante o agendamento.</p></div></li>
            <li><span className="google-calendar-benefit-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 11l2 2 4-5" /></svg></span><div><h3>Histórico do CRM</h3><p>Associe reuniões ao lead e preserve cada avanço da relação.</p></div></li>
          </ul>
          <footer><span aria-hidden="true" />Você autoriza somente os escopos necessários. Os tokens ficam criptografados e nunca aparecem no navegador.</footer>
        </section>
      )}
      </div>
    </div>
  );
}
