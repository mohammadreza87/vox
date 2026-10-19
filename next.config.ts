import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER } from 'next/constants';

const nextConfig: NextConfig = {
  // Keep each production release independent of the working checkout.
  output: 'standalone',
  // Mark firebase-admin as external to prevent bundling issues
  serverExternalPackages: ['firebase-admin'],

  // Ensure images from external sources work
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

// Sentry configuration options
const sentryWebpackPluginOptions = {
  // Suppress source map upload logs during build
  silent: true,
  // Organization and project (set via environment variables)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Auth token for source map upload (optional, set in CI/CD)
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Disable source map upload in development
  disableServerWebpackPlugin: process.env.NODE_ENV !== 'production',
  disableClientWebpackPlugin: process.env.NODE_ENV !== 'production',
  // Hide source maps from end users
  hideSourceMaps: true,
  // Widens the scope of the automatic instrumentation
  widenClientFileUpload: true,
  // Tunneling to avoid ad blockers (optional)
  tunnelRoute: '/monitoring',
};

export default async function config(phase: string): Promise<NextConfig> {
  // Firebase bundles this file again for its production-only Functions package.
  // Sentry's build wrapper must not initialize there; Next serves the compiled
  // rewrites and instrumentation produced during the build.
  if (phase === PHASE_PRODUCTION_SERVER || !process.env.NEXT_PUBLIC_SENTRY_DSN) return nextConfig;
  const { withSentryConfig } = await import('@sentry/nextjs');
  return withSentryConfig({ ...nextConfig }, { ...sentryWebpackPluginOptions });
}
