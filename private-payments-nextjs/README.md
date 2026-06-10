# Umbra Private Payments (Next.js example)

A private-payments app on Solana, powered by **Umbra** (`@umbra-privacy/sdk@5.0.0-rc.6`,
protocol V18). Scaffolded from the `umbra-sdk` skill template and restructured into the
**5 private-payment steps**, one tab each. Defaults to **mainnet-beta** + **USDC**; a
`.env.local` is **optional** (mainly to point the RPC at a paid endpoint).

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

**`.env` is optional — it runs with none.** The network (mainnet-beta), default
mint (USDC), and indexer/relayer endpoints all come from a single switch in
[`lib/network-config.ts`](lib/network-config.ts), so it works against the public
mainnet RPC out of the box.

The one thing you'll likely want in a `.env`: a paid RPC. The public mainnet RPC
rate-limits under load, so for reliable scans/deposits create a gitignored
`.env.local` (see [`.env.example`](.env.example)) with:

```bash
# optional — overrides the public RPC default
NEXT_PUBLIC_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

(The RPC is the only value left in env — and only because it's a paid key that
shouldn't be committed into browser-exposed source. Everything else is hardcoded.)

This is **mainnet — real funds.** Connect a Solana wallet set to mainnet
(Phantom/Backpack/Solflare), fund it with SOL (for fees + the Arcium MPC queue)
and USDC, then walk tabs 1 → 5.

### Switching network

No code change needed — set it in `.env.local`:

```bash
NEXT_PUBLIC_NETWORK=devnet
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com   # or a paid devnet endpoint
```

That single switch drives **everything coherently** — SDK network, default mint
(USDC ↔ dUSDC), the supported-token dropdown, and the indexer/relayer proxy
upstreams. (It's resolved in [`lib/network-config.ts`](lib/network-config.ts),
which both `lib/env.ts` and `next.config.ts` read; the in-code default is
mainnet.) On devnet, fund from https://faucet.umbraprivacy.com/.

## Architecture

- **Signer** (`lib/signer.ts`): Wallet Standard → `IUmbraSigner`, custom (NOT the SDK's `createSignerFromWalletAccount`). It adopts the wallet's *fully decoded* transaction whenever the wallet mutates the message — Solflare injects a priority-fee ComputeBudget instruction under load, which breaks the SDK's "graft signature onto original message" approach and causes intermittent `"Transaction did not pass signature verification"`. No-op for wallets that leave the message intact.
- **Token picker** (`components/MintSelect.tsx`): the UI shows symbols (USDC, USDT, …); the mint address is mapped internally and never shown or typed.
- **Client** (`lib/umbra-client.ts`): 3-phase build keyed by wallet address; wires the SDK's **standard** encrypted-sharded IndexedDB stores — `createShardedUtxoDataStore` + `createShardedNullifierStore` (`@umbra-privacy/sdk/store-adapters`) — plus **polling** transaction/computation transport (works on any RPC over HTTP).
- **Stores / Claim model**: the zero-arg `scan()` advances each tree's cursor and **persists** every decrypted note into `utxoDataStore`. The Claim tab **auto-scans on load**, then *queries* the store (`client.utxoDataStore.query({ network, signerAddress })`) for the full known-note set, reconciles against the on-chain nullifier set, and lists every **non-burnt** note with its own **Claim** button (plus a *Claim all* batch). Burnt notes are hidden via the on-chain nullifier reconcile + a local burnt-index (`lib/claimed-index-store.ts`).
- **Master seed**: derived once by signing the Umbra message (read-only; no spend authority), then **persisted in localStorage** keyed per wallet — so the wallet only ever signs once, even across reloads and sessions. (Example-grade; clearing site data forces a fresh signature. localStorage is not safe for production keys.)
- **Indexer/relayer**: proxied via `/proxy/...` rewrites in `next.config.ts` to the hardcoded mainnet upstreams — browser never hits them directly (CORS + IP hiding).
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
- Cross-account flows (Transfer → recipient → their Claim) need two wallets, both registered on mainnet.
- Docs: https://sdk.umbraprivacy.com/ · supported tokens: https://sdk.umbraprivacy.com/supported-tokens
