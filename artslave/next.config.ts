import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Exclude better-sqlite3 from client-side bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'better-sqlite3': false,
        'fs': false,
        'path': false,
      };
    }
    return config;
  },
  serverExternalPackages: ['better-sqlite3', 'pdf-parse'],
};

export default nextConfig;
