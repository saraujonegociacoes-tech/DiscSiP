import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Necessário para OpenNext/Cloudflare Workers
  output: "standalone",
};

export default nextConfig;
