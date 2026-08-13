import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
    ],
  },
};

export default async function configureNext(phase: string) {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return nextConfig;
  }

  const { withSentryConfig } = await import("@sentry/nextjs");

  return withSentryConfig(nextConfig, {
    org: "sigma-y0",
    project: "keepr-one",
    silent: true,
    sourcemaps: {
      disable: true,
    },
    webpack: {
      treeshake: {
        removeDebugLogging: true,
      },
    },
  });
}
