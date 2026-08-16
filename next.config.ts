import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone with only the traced dependency set, so the runtime
  // image carries a server bundle instead of the whole node_modules tree. The
  // Dockerfile runner stage copies that output and nothing else.
  output: 'standalone',
  // The Postgres driver is a native-ish dependency that must never be bundled
  // into the client graph. Keeping it external also keeps the tenant pool a
  // true server-side singleton.
  serverExternalPackages: ['pg'],
  eslint: {
    // Lint runs as its own CI step (pnpm lint) so a build does not silently
    // skip the admin-client import ban.
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
