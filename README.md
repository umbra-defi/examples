# Umbra examples

Reference applications for **[Umbra](https://umbraprivacy.com)** — a privacy
protocol for Solana that shields SPL / Token-2022 balances using Arcium MPC and
zero-knowledge proofs. Everything here is built on the public TypeScript SDK,
[`@umbra-privacy/sdk`](https://www.npmjs.com/package/@umbra-privacy/sdk)
(`5.0.0-rc.6`, protocol V18).

## What's here

- **[`private-payments-nextjs/`](./private-payments-nextjs)** — a full **private-payments Next.js app** (devnet,
  dUSDC). Wallet-only signer, the SDK's standard browser store adapters
  (`createShardedUtxoDataStore` + `createShardedNullifierStore`), and the five
  private-payment steps as one tab each:

  1. **Register** — Umbra registration (3-step, idempotent) + key-consistency restore.
  2. **Deposit** — public ATA → your EncryptedTokenAccount (ETA), via MPC.
  3. **Transfer** — write a Stealth Pool Note from your ETA (receiver- or self-claimable).
  4. **Claim** — scan + burn notes addressed to you (→ ETA or ATA).
  5. **Withdraw** — ETA → your public ATA (unshield), via MPC.

  See [`private-payments-nextjs/README.md`](./private-payments-nextjs/README.md) for the full walkthrough
  and architecture.

- **[`compliance-auditor/`](./compliance-auditor)** — a **headless** (no-UI)
  selective-disclosure example: derive the scoped viewing-key hierarchy
  (Master → Mint → Monthly → Daily) and issue / query / revoke an on-chain X25519
  re-encryption grant to an auditor. A framework-agnostic core (`src/core/`) +
  a thin Node CLI demo — drop the core into a CLI, React, or mobile app unchanged.
  See [`compliance-auditor/README.md`](./compliance-auditor/README.md).

## Run the app

```bash
cd private-payments-nextjs
pnpm install
pnpm dev              # http://localhost:3000
```

Connect a Solana wallet **set to devnet**, fund it from the
[faucet](https://faucet.umbraprivacy.com/), then walk tabs 1 → 5.

## Versions

Built on `@umbra-privacy/sdk@5.0.0-rc.6`, which pins `@umbra-privacy/umbra-codama@3.0.0-rc.6`.
No package-manager overrides or dist patches are needed — the earlier `rc.3`/`rc.4`
codama PDA bug (`ConstraintSeeds 2006`) and columnar `scan()` bug are both fixed in rc.6.
Just `pnpm install`.

## Links

- Docs: https://sdk.umbraprivacy.com/
- Supported tokens: https://sdk.umbraprivacy.com/supported-tokens
- SDK on npm: https://www.npmjs.com/package/@umbra-privacy/sdk
