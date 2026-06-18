import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Reduz o pico de memória do build (máquinas com pouca RAM / OneDrive).
  experimental: {
    webpackMemoryOptimizations: true,
    cpus: 1,
  },
};

export default nextConfig;
