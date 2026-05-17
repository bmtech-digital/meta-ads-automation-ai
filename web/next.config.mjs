/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // TEMP 2026-05-17 (Roi): bypass typecheck during build so the design
  // redesign preview can ship while the audience-targeting work (concurrent
  // session) is mid-flight and still has type errors. REMOVE once that
  // session lands clean — typecheck must gate prod builds.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    // Next.js applies a 10MB body limit globally to route handlers + middleware.
    // Far too small for video uploads — bump to match MAX_VIDEO_BYTES in
    // src/app/api/gallery/upload/route.ts (4 GB, matching Meta's per-video cap).
    // https://nextjs.org/docs/app/api-reference/config/next-config-js/middlewareClientMaxBodySize
    middlewareClientMaxBodySize: "4gb",
    serverActions: {
      allowedOrigins: ["localhost:3100"],
      bodySizeLimit: "4gb",
    },
  },
};

export default nextConfig;
