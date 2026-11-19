import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    '10.7.5.154',
    '10.7.4.210',
    'localhost',
    '127.0.0.1',
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  turbopack: {
    /**
     * Pin the workspace root to this app.
     *
     * Turbopack walks upwards looking for a lockfile to infer the root. A
     * stray package-lock.json anywhere above the repo - a home directory is
     * the usual culprit - makes it pick the wrong one and warn on every start.
     */
    root: path.join(__dirname),
  },
};

export default nextConfig;
