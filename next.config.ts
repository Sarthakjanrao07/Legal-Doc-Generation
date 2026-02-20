import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel automatically handles the output, no need for standalone
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: true,
  // Enable experimental features for better performance
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
};

export default nextConfig;
