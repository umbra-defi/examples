// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for which network this example targets.
//
// Change the one `NETWORK` line below and EVERYTHING follows coherently — the
// SDK network, the default RPC, the default token mint, and the indexer/relayer
// proxy upstreams. Both lib/env.ts (browser config) and next.config.ts (proxy
// rewrites) read from this module, so they can never drift apart.
//
// This file is pure constants only — no browser/Node APIs — so next.config.ts
// can import it at build time.
// ─────────────────────────────────────────────────────────────────────────────

export type Network = "mainnet" | "devnet" | "localnet";

// THE switch — defaults to mainnet, overridable via .env.local without touching
// code: set NEXT_PUBLIC_NETWORK=devnet (or "mainnet" / "mainnet-beta"). Anything
// unset/unrecognised falls back to mainnet. This one value drives the SDK
// network, RPC, mint, supported-token dropdown, and indexer/relayer upstreams.
const ENV_NETWORK = process.env.NEXT_PUBLIC_NETWORK?.trim().toLowerCase();
export const NETWORK: "mainnet" | "devnet" =
  ENV_NETWORK === "devnet"
    ? "devnet"
    : "mainnet"; // "mainnet" | "mainnet-beta" | unset → mainnet

export interface NetworkConfig {
  /** SDK network string. */
  sdkNetwork: Network;
  /** Value exposed as NEXT_PUBLIC_NETWORK / used by the supported-mint filter. */
  cluster: "mainnet-beta" | "devnet";
  /** Public default RPC (overridable via .env.local → NEXT_PUBLIC_RPC_URL). */
  defaultRpcUrl: string;
  /** Default token the UI pre-selects (must be on the network's supported list). */
  defaultMint: string;
  /** Server-side proxy upstreams (next.config.ts /proxy/... rewrites). */
  indexerUpstream: string;
  relayerUpstream: string;
}

const CONFIGS: Record<"mainnet" | "devnet", NetworkConfig> = {
  mainnet: {
    sdkNetwork: "mainnet",
    cluster: "mainnet-beta",
    defaultRpcUrl: "https://api.mainnet-beta.solana.com",
    defaultMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    indexerUpstream: "https://utxo-indexer.api.umbraprivacy.com",
    relayerUpstream: "https://relayer.api.umbraprivacy.com",
  },
  devnet: {
    sdkNetwork: "devnet",
    cluster: "devnet",
    defaultRpcUrl: "https://api.devnet.solana.com",
    defaultMint: "4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7", // dUSDC
    indexerUpstream: "https://utxo-indexer.api-devnet.umbraprivacy.com",
    relayerUpstream: "https://relayer.api-devnet.umbraprivacy.com",
  },
};

/** Resolved config for the active NETWORK — import this everywhere. */
export const ACTIVE: NetworkConfig = CONFIGS[NETWORK];
