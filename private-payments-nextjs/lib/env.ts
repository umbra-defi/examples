// Browser-facing config, derived from the single NETWORK switch in
// lib/network-config.ts. To retarget devnet, change NETWORK there — network,
// mint, indexer, and relayer all follow (next.config.ts reads the same module).
//
// The ONE value worth overriding locally is the RPC URL: the default is the
// network's PUBLIC endpoint (rate-limits under load). Override it for local
// testing via a gitignored .env.local → NEXT_PUBLIC_RPC_URL (a paid Helius/
// Triton/QuickNode endpoint). It is NOT hardcoded because this is browser-
// exposed code that gets committed — an inlined paid key would leak.

import { ACTIVE, type Network } from "./network-config";

export type { Network };

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL?.trim() || ACTIVE.defaultRpcUrl;
const RPC_WS_URL =
  process.env.NEXT_PUBLIC_RPC_WS_URL?.trim() || RPC_URL.replace(/^http/, "ws");

export const env = {
  NEXT_PUBLIC_NETWORK: ACTIVE.cluster,
  NEXT_PUBLIC_RPC_URL: RPC_URL,
  NEXT_PUBLIC_RPC_WS_URL: RPC_WS_URL,
  NEXT_PUBLIC_DEFAULT_MINT: ACTIVE.defaultMint,
  // Browser hits same-origin proxy paths; next.config.ts forwards to the
  // network's indexer/relayer (avoids CORS, hides client IP).
  NEXT_PUBLIC_INDEXER_URL: "/proxy/indexer",
  NEXT_PUBLIC_RELAYER_URL: "/proxy/relayer",
  // "polling" works on any RPC over HTTP (no WebSocket needed).
  NEXT_PUBLIC_RPC_TRANSPORT: "polling",
} as const;

export function deriveWsUrl(): string {
  return env.NEXT_PUBLIC_RPC_WS_URL;
}

export function rpcTransport(): "polling" | "websocket" {
  return env.NEXT_PUBLIC_RPC_TRANSPORT;
}

export function umbraNetwork(): Network {
  return ACTIVE.sdkNetwork;
}
