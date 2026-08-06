import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Varredura das tabelas que o conector local faz crescer para sempre. Este
    // hook é o único ponto de boot que o deploy tem — não há cron — e sem ele a
    // varredura seria código escrito e nunca executado, que é exatamente o
    // destino que `expiresAt` teve até aqui.
    const { startLocalConnectorJanitor } = await import(
      "./lib/national-life/local-connector/janitor-scheduler"
    );
    startLocalConnectorJanitor();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
