/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
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
