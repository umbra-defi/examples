import type { NextConfig } from "next";

// Indexer + relayer requests are PROXIED via `/proxy/...` rewrites.
// The browser never talks to the upstream Umbra services directly —
// this avoids CORS, hides client IPs (indexer.md "IP-obfuscation note"),
// and lets you swap upstream hosts without changing browser code.
//
// Server-only env vars `INDEXER_UPSTREAM` and `RELAYER_UPSTREAM` set
// where each `/proxy/...` route forwards to. They are NEVER exposed to
// the browser. The browser-facing `NEXT_PUBLIC_INDEXER_URL` and
// `NEXT_PUBLIC_RELAYER_URL` always point at `/proxy/indexer` and
// `/proxy/relayer` respectively.
//
// `transpilePackages` is required because the Umbra SDK ships ESM that
// Next still wants to pre-process.

function indexerUpstream(): string {
  return (
    process.env["INDEXER_UPSTREAM"]?.trim() ||
    "https://utxo-indexer.api.umbraprivacy.com"
  );
}

function relayerUpstream(): string {
  return (
    process.env["RELAYER_UPSTREAM"]?.trim() ||
    "https://relayer.api.umbraprivacy.com"
  );
}

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
      { source: "/proxy/indexer/:path*", destination: `${indexerUpstream()}/:path*` },
      { source: "/proxy/relayer/:path*", destination: `${relayerUpstream()}/:path*` },
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
