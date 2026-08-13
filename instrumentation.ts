import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Varredura das tabelas que o conector local faz crescer para sempre. Este
    // hook é o único ponto de boot que o deploy tem — não há cron — e sem ele a
    // varredura seria código escrito e nunca executado, que é exatamente o
    // destino que `expiresAt` teve até aqui.
    //
    // Envolto em try/catch porque a assimetria importa: uma varredura em
    // segundo plano pode não rodar, mas não pode impedir o app de servir. Um
    // NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS digitado errado lança na validação,
    // e sem este catch esse throw derruba o boot — que o healthcheck do
    // Dockerfile transforma em deploy falho. Uma flag que trava o boot não é
    // uma alavanca de emergência.
    try {
      const { startLocalConnectorJanitor } = await import(
        "./lib/national-life/local-connector/janitor-scheduler"
      );
      startLocalConnectorJanitor();
    } catch (error) {
      Sentry.captureException(error);
    }

    // Follow-up reminders are persisted server-side even if no user has the
    // application open. Each pass catches up every due reminder and the domain
    // dedupe key makes restarts/retries safe. As with the janitor, a scheduler
    // configuration or database failure must never make the web server fail to
    // boot.
    try {
      const { startFollowUpNotificationScheduler } = await import(
        "./lib/crm/follow-up-notification-scheduler"
      );
      startFollowUpNotificationScheduler();
    } catch (error) {
      Sentry.captureException(error);
    }

    // Google push notifications are wake-ups, not event payloads. The durable
    // outbox applies those incremental syncs and a conservative reconciliation
    // pass repairs missed webhooks / renews expiring channels. Configuration is
    // optional and boot must remain available when the integration is disabled.
    try {
      const { startGoogleCalendarScheduler } = await import(
        "./lib/calendar/google/scheduler"
      );
      startGoogleCalendarScheduler();
    } catch (error) {
      Sentry.captureException(error);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
