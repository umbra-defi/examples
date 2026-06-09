# Umbra Private Payments (Next.js example)

A private-payments app on Solana, powered by **Umbra** (`@umbra-privacy/sdk@5.0.0-rc.6`,
protocol V18). Scaffolded from the `umbra-sdk` skill template and restructured into the
**5 private-payment steps**, one tab each. Targets **devnet** + **dUSDC**.

## The 5 tabs

| # | Tab | Route | What it does | SDK |
|---|-----|-------|--------------|-----|
| 1 | **Register** | `/register` | Umbra registration (3-step, idempotent) + key rotation/re-key to the current seed | `getUserRegistrationFunction`, `getRestoreKeyConsistencyFunction` |
| 2 | **Deposit** | `/deposit` | Public ATA → your EncryptedTokenAccount (ETA), MPC | `getATAIntoETADirectDepositorFunction` |
| 3 | **Transfer** | `/transfer` | Stealth Pool Note from your ETA — receiver-claimable (→ recipient's ETA) or self-claimable (→ your ATA) | `getETAInto{Receiver,Self}BurnableStealthPoolNoteCreatorFunction` |
| 4 | **Claim** | `/claim` | Scan + burn notes addressed to you (→ ETA or ATA) | scanner + `get{Receiver,Self}Burnable…BurnerFunction` |
| 5 | **Withdraw** | `/withdraw` | ETA → your public ATA (unshield), MPC | `getETAIntoATAWithdrawerFunction` |

## Quick start

```bash
pnpm install
pnpm dev              # http://localhost:3000
# or: pnpm build && pnpm start
```

`.env.local` is preconfigured for devnet (RPC `api.devnet.solana.com`, polling
transport, dUSDC mint, indexer/relayer proxied to the `*-devnet` upstreams). For
heavier use swap `NEXT_PUBLIC_RPC_URL` for a paid RPC.

Connect a Solana wallet **set to devnet** (Phantom/Backpack/Solflare). Fund it with
devnet SOL + dUSDC (https://faucet.umbraprivacy.com/), then walk tabs 1 → 5.

## Architecture

- **Signer**: Wallet Standard → `IUmbraSigner` (`createSignerFromWalletAccount({ wallet, account })`). Wallet-only — there is no keypair/dev signer.
- **Client** (`lib/umbra-client.ts`): 3-phase build keyed by wallet address; wires the SDK's **standard** encrypted-sharded IndexedDB stores — `createShardedUtxoDataStore` + `createShardedNullifierStore` (`@umbra-privacy/sdk/store-adapters`) — plus **polling** transaction/computation transport (public devnet RPC refuses WebSocket subscriptions).
- **Stores / Claim model**: the zero-arg `scan()` advances each tree's cursor and **persists** every decrypted note into `utxoDataStore`. The Claim tab therefore *scans to ingest new leaves, then **queries** the store* (`client.utxoDataStore.query({ network, signerAddress })`) for the full known-note set — so notes survive reloads and incremental re-scans. Burnt notes are hidden via a small local burnt-index (`lib/claimed-index-store.ts`); the `nullifierStore` tracks the canonical burn lifecycle.
- **Master seed**: re-derived each session by signing the Umbra message (read-only; no spend authority). Cached in-memory so the wallet signs once.
- **Indexer/relayer**: proxied via `/proxy/...` rewrites in `next.config.ts` to the devnet upstreams (`INDEXER_UPSTREAM` / `RELAYER_UPSTREAM`) — browser never hits them directly (CORS + IP hiding).
- **ZK provers** (`lib/zk-prover.ts`): per-circuit, CDN assets, main thread (wrap in a Web Worker for production — advanced.md §5).
- **RegistrationGate**: blocks every tab until the wallet is fully registered *and* key-consistent; offers a restore if on-chain keys came from a different seed.

## Project layout

```
app/
  page.tsx        landing + 5-step overview
  register/       tab 1 — register + key rotation
  deposit/        tab 2 — PATA → ETA
  transfer/       tab 3 — stealth-note creates (receiver / self)
  claim/          tab 4 — scan + burn
  withdraw/       tab 5 — ETA → PATA
  providers.tsx   UmbraSessionProvider (wallets + client, keyed by account)
components/       Nav (5 tabs), WalletButton, RegistrationGate, ScanWorker, …
lib/              env, signer, umbra-client, zk-prover, claim-*, supported-mints, …
```

## Notes

- The "multiple lockfiles" build warning is benign (a parent `pnpm-lock.yaml` exists higher up); set `outputFileTracingRoot` in `next.config.ts` to silence it.
- Cross-account flows (Transfer → recipient → their Claim) need two wallets, both registered on devnet.
- Docs: https://sdk.umbraprivacy.com/ · supported tokens: https://sdk.umbraprivacy.com/supported-tokens
