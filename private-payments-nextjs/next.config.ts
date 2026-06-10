import type { NextConfig } from "next";
import { ACTIVE } from "./lib/network-config";

// Indexer + relayer requests are PROXIED via `/proxy/...` rewrites.
// The browser never talks to the upstream Umbra services directly —
// this avoids CORS and hides client IPs (indexer.md "IP-obfuscation note").
//
// The upstreams come from the SAME single NETWORK switch as lib/env.ts
// (lib/network-config.ts), so flipping the network retargets the proxy too —
// they can't drift apart.
//
// `transpilePackages` is required because the Umbra SDK ships ESM that
// Next still wants to pre-process.

const INDEXER_UPSTREAM = ACTIVE.indexerUpstream;
const RELAYER_UPSTREAM = ACTIVE.relayerUpstream;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@umbra-privacy/sdk"],
  webpack: (config) => {
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      fs: false,
    };
    return config;
  },
  async rewrites() {
    return [
      { source: "/proxy/indexer/:path*", destination: `${INDEXER_UPSTREAM}/:path*` },
      { source: "/proxy/relayer/:path*", destination: `${RELAYER_UPSTREAM}/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
