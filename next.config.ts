import type { NextConfig } from "next";
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
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

// Wrap with Sentry only if DSN is configured
const configWithSentry = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;

export default configWithSentry;
