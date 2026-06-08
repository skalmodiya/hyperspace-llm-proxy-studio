import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for Docker.
  output: "standalone",
  reactStrictMode: true,
  // Pin the workspace root so Next.js doesn't pick up a parent-folder lockfile.
  turbopack: { root: path.resolve(__dirname) },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
