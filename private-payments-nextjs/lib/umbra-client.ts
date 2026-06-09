// Thin wrapper around getUmbraClient. The client is keyed by signer
// address — the React provider in app/providers.tsx invalidates this
// when the connected wallet changes (see pitfalls.md §7c — wallet-change
// client invalidation).
//
// Master-seed storage default: re-derive every session via
// signer.signMessage(UMBRA_MESSAGE_TO_SIGN). Zero persistence, zero
// attack surface. To skip the per-session signature, supply a
// `masterSeedStorage.load`/`store` override here. Read pitfalls.md §7
// before doing so.
//
// The client is wired with browser-backed `utxoDataStore` +
// `nullifierStore` so the zero-arg scanner can resume per-tree progress
// across sessions (see SKILL.md Rule 8). Without these, every scan()
// iterates from genesis across every active tree.
//
// Store wiring is two-phase: `createShardedUtxoDataStore` / `createShardedNullifierStore`
// derive their encryption keys from the client's master seed, so they need a
// constructed client. We build a bootstrap client first (which derives + caches
// the seed once), build the stores from it, then build the final client with the
// stores wired into `deps`. A shared in-memory master-seed cache makes both
// `getUmbraClient` calls reuse the same seed — the wallet signs only once.

import { getUmbraClient } from "@umbra-privacy/sdk";
import type { IUmbraClient } from "@umbra-privacy/sdk";
import type { MasterSeed } from "@umbra-privacy/sdk/types";
import {
  createBrowserStorageBackend,
  createShardedNullifierStore,
  createShardedUtxoDataStore,
} from "@umbra-privacy/sdk/store-adapters";
import { getPollingComputationMonitor } from "@umbra-privacy/sdk/arcium";
import { getPollingTransactionForwarder } from "@umbra-privacy/sdk/solana";
import { env, deriveWsUrl, umbraNetwork, rpcTransport } from "./env";
import { umbraSignerFromWallet } from "./signer";
import { dbg } from "./umbra-debug";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

// Transaction confirmation + Arcium MPC-callback monitoring transport.
// Public RPCs (notably `api.devnet.solana.com`) throttle/refuse WebSocket
// subscriptions, which surfaces mid-transaction as "Failed to establish
// WebSocket subscription". When NEXT_PUBLIC_RPC_TRANSPORT is "polling" (the
// default) we inject HTTP-polling implementations for BOTH the transaction
// forwarder and the computation monitor, so confirmation never depends on a
// WS connection. These two are the only WebSocket consumers in the client
// (see GetUmbraClientDeps). Switch to "websocket" only with a WS-capable RPC.
function transportDeps(): {
  transactionForwarder?: ReturnType<typeof getPollingTransactionForwarder>;
  computationMonitor?: ReturnType<typeof getPollingComputationMonitor>;
} {
  if (rpcTransport() !== "polling") return {};
  const rpcUrl = env.NEXT_PUBLIC_RPC_URL;
  return {
    transactionForwarder: getPollingTransactionForwarder({ rpcUrl }),
    computationMonitor: getPollingComputationMonitor({ rpcUrl }),
  };
}

const cache = new Map<string, Promise<IUmbraClient>>();

export async function getOrCreateUmbraClient(
  wallet: Wallet,
  account: WalletAccount,
): Promise<IUmbraClient> {
  const key = account.address;
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const signer = umbraSignerFromWallet(wallet, account);

    // Shared in-memory master-seed cache: derived once on the bootstrap
    // client, reused by the final client so the wallet signs only once.
    let cachedSeed: MasterSeed | undefined;
    const masterSeedStorage = {
      load: async () =>
        cachedSeed !== undefined
          ? ({ exists: true, seed: cachedSeed } as const)
          : ({ exists: false } as const),
      store: async (seed: MasterSeed) => {
        cachedSeed = seed;
        return { success: true } as const;
      },
    };

    const config = {
      signer,
      network: umbraNetwork(),
      rpcUrl: env.NEXT_PUBLIC_RPC_URL,
      rpcSubscriptionsUrl: deriveWsUrl(),
      indexerApiEndpoint: env.NEXT_PUBLIC_INDEXER_URL,
      // The relayer is NOT a getUmbraClient arg — it is built separately in
      // claim-service.ts via getUmbraRelayer({ apiEndpoint: NEXT_PUBLIC_RELAYER_URL }).
    };

    // Confirmation/MPC transport (polling by default — see transportDeps).
    const transport = transportDeps();
    dbg("client", `building client for ${account.address.slice(0, 8)}… · ${rpcTransport()} transport · rpc=${env.NEXT_PUBLIC_RPC_URL}`);

    // Phase 1 — bootstrap client (no stores). Derives + caches the master seed.
    const bootstrap = await getUmbraClient(config, { masterSeedStorage, ...transport });

    // Phase 2 — the SDK's STANDARD sharded stores (encrypted, IndexedDB-backed):
    //   - utxoDataStore  — persists every decrypted note + per-tree scan progress.
    //   - nullifierStore — tracks the burn lifecycle (scanned → submitted → confirmed).
    //
    // The scanner advances the per-tree cursor and PUTs each discovered note into
    // utxoDataStore, so notes survive reloads and incremental re-scans. The Claim
    // page therefore scans (to ingest new leaves) and then QUERIES the store for
    // the full set of known notes — no custom watermark cursor needed.
    const backend = createBrowserStorageBackend();
    const nullifierStore = await createShardedNullifierStore(bootstrap, backend);
    const utxoDataStore = await createShardedUtxoDataStore(bootstrap, backend);

    // Phase 3 — final client (seed loaded from cache; no re-sign).
    return getUmbraClient(config, {
      masterSeedStorage,
      utxoDataStore,
      nullifierStore,
      ...transport,
    });
  })();

  cache.set(key, promise);
  return promise;
}

export function invalidateUmbraClient(address: string): void {
  cache.delete(address);
}

export function clearUmbraClientCache(): void {
  cache.clear();
}
