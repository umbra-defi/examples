# Umbra examples

Reference applications for **[Umbra](https://umbraprivacy.com)** — a privacy
protocol for Solana that shields SPL / Token-2022 balances using Arcium MPC and
zero-knowledge proofs. Everything here is built on the public TypeScript SDK,
[`@umbra-privacy/sdk`](https://www.npmjs.com/package/@umbra-privacy/sdk)
(`5.0.0-rc.4`, protocol V18).

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

  See [`private-payments-nextjs/README.md`](./private-payments-nextjs/README.md) for the full walkthrough,
  architecture, and the one required `rc.4` SDK patch.

## Run the app

```bash
cd private-payments-nextjs
pnpm install          # runs scripts/patch-sdk.mjs via postinstall
pnpm dev              # http://localhost:3000
```

Connect a Solana wallet **set to devnet**, fund it from the
[faucet](https://faucet.umbraprivacy.com/), then walk tabs 1 → 5.

## Required override (V18 / rc.4)

`@umbra-privacy/sdk@5.0.0-rc.4` resolves `@umbra-privacy/umbra-codama@3.0.0-rc.3`,
which has a PDA-derivation bug that makes deposits fail on-chain with
`ConstraintSeeds (2006)`. Each example pins the fixed codama release in its
`package.json`:

```jsonc
{ "pnpm": { "overrides": { "@umbra-privacy/umbra-codama": "3.0.0-rc.4" } } }
```

There is also a known `scan()` bug in `rc.3`–`rc.4` (a `BigInt()` call on a
base64 field); each example ships a one-file `scripts/patch-sdk.mjs` wired as a
`postinstall` hook to work around it until the SDK ships a fix.

## Links

- Docs: https://sdk.umbraprivacy.com/
- Supported tokens: https://sdk.umbraprivacy.com/supported-tokens
- SDK on npm: https://www.npmjs.com/package/@umbra-privacy/sdk
