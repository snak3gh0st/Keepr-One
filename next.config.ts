import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native canvas bindings must remain Node externals. PDF.js uses them only
  // during server-side PDF extraction, and standalone tracing carries their
  // platform binary into the production image.
  serverExternalPackages: ['@napi-rs/canvas'],
  // Coolify builds on the same 8 GB host that serves production. Next otherwise
  // fans page-data collection out to every visible CPU and can starve the live
  // containers even though the old release remains available during the build.
  experimental: {
    cpus: 2,
    // Allow multipart overhead while document validation retains its 10 MiB limit.
    serverActions: { bodySizeLimit: '12mb' },
  },
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
