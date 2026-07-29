import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://7557d83d3853c055ea24d294965b78c1@o4510463123849216.ingest.us.sentry.io/4511819102552064",
  tracesSampleRate: 0.1,
  debug: false,
});
