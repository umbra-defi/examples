// Framework-agnostic Umbra client builder.
//
// PURE: no Node APIs, no console, no filesystem. You inject an `IUmbraSigner`
// (from a CLI keypair, a browser Wallet-Standard adapter, an Android JSI bridge,
// …) and the network endpoints. This is the single seam every frontend shares —
// the compliance logic in `compliance.ts` only ever touches the returned client.

import { getUmbraClient } from "@umbra-privacy/sdk";
import type { IUmbraClient, IUmbraSigner } from "@umbra-privacy/sdk";

export type UmbraNetwork = "devnet" | "mainnet" | "localnet";

export interface UmbraEndpoints {
  /** Solana JSON-RPC HTTP URL. */
  rpcUrl: string;
  /** Solana JSON-RPC WebSocket URL. Defaults to the HTTP URL with the scheme swapped to ws(s). */
  rpcSubscriptionsUrl?: string;
  /** Umbra UTXO indexer — only required if you extend the auditor to scan notes. */
  indexerApiEndpoint?: string;
}

export interface BuildClientOptions {
  signer: IUmbraSigner;
  network: UmbraNetwork;
  endpoints: UmbraEndpoints;
}

/** Build an Umbra client from an injected signer + endpoints. Works in any runtime. */
export async function buildUmbraClient(opts: BuildClientOptions): Promise<IUmbraClient> {
  const { signer, network, endpoints } = opts;
  return getUmbraClient({
    signer,
    network,
    rpcUrl: endpoints.rpcUrl,
    rpcSubscriptionsUrl:
      endpoints.rpcSubscriptionsUrl ?? endpoints.rpcUrl.replace(/^http/, "ws"),
    indexerApiEndpoint: endpoints.indexerApiEndpoint,
  });
}
