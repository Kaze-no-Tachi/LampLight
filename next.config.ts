import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
