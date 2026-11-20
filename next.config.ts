import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md into the repo.
  agentRules: false,
  async headers() {
    // The card art never changes between deploys of the same build: let browsers and the CDN keep it.
    return [{ source: "/cards/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] }];
  },
};

export default config;
