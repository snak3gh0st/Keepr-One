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
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
