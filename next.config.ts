import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark firebase-admin as external to prevent bundling issues with Turbopack
  serverExternalPackages: ['firebase-admin'],

  // Empty turbopack config to use Turbopack (default in Next.js 16)
  turbopack: {},

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

export default nextConfig;
