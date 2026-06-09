# Umbra Compliance Auditor (headless example)

**Selective disclosure** on Umbra — how a user grants an auditor scoped, revocable
read access to their otherwise-private activity. Pure scripts, **no UI**: a
framework-agnostic core (`src/core/`) plus a thin Node CLI demo (`src/cli.ts`).
Built on [`@umbra-privacy/sdk@5.0.0-rc.6`](https://www.npmjs.com/package/@umbra-privacy/sdk)
(protocol V18).

## The two disclosure mechanisms

Umbra exposes two independent ways to disclose — this example covers both:

1. **Viewing keys** — *off-chain, read-only, no transaction.* A Poseidon-keyed
   hierarchy: **Master → Mint → Yearly → Monthly → Daily**. Each level is a scoped
   read credential the subject derives from their master seed and hands to the
   auditor out-of-band. **Master** sees everything; **Daily** sees one mint on one
   day. Disclose the narrowest scope that satisfies the mandate.
2. **X25519 re-encryption grant** — *on-chain, MPC, revocable, per-auditor.* The
   subject authorises one specific (registered) auditor to have the network
   re-encrypt the subject's `EncryptedTokenAccount` ciphertexts to the auditor's
   key. **Issue → query → revoke.**

## What the demo does

`pnpm demo` runs, as the **subject**:

1. Derives the scoped viewing-key hierarchy for a mint + today's date.
2. Issues an X25519 re-encryption grant to the **auditor** (MPC tx).
3. Queries the grant's on-chain state.
4. Revokes it (MPC tx).

## The abstraction (why there's no UI)

The point of this example is the **seam**, so you can drop it into a CLI, a React
app, or an Android/iOS bridge unchanged:

- **`src/core/client.ts`** — `buildUmbraClient({ signer, network, endpoints })`.
  Pure. You inject an `IUmbraSigner` from wherever your platform gets one (a CLI
  keypair, a browser Wallet-Standard adapter, a mobile JSI bridge).
- **`src/core/compliance.ts`** — `deriveScopedViewingKeys`, `issueComplianceGrant`,
  `queryComplianceGrant`, `revokeComplianceGrant`. Pure — each takes the client and
  returns plain data. No `console`, no `fs`, no runtime assumptions.
- **`src/cli.ts`** — the **only** Node-specific layer: reads keypair files + env and
  prints. To port, replace just this file:
  - **React** — build the signer with `createSignerFromWalletAccount({ wallet, account })`, call the same `core/` functions inside a hook, render the returned data.
  - **Android/iOS** — provide a signer over your native bridge; the `core/` calls are identical.

## Roles

- **Subject** — the user being audited. Holds the master seed; derives viewing keys
  and issues/revokes grants. (`SUBJECT_KEYPAIR`)
- **Auditor** — the grantee. Must already be **registered on Umbra** (have an X25519
  key) before a grant can target them. With the daily/master viewing key they
  decrypt the subject's notes for that scope; with the grant they read the subject's
  `EncryptedTokenAccount` balance via the SDK re-encryptors
  (`getSharedCiphertextReencryptorForUserGrantFunction`). (`AUDITOR_KEYPAIR`)

## Quick start

```bash
pnpm install
cp .env.example .env        # defaults target devnet + dUSDC

# Two Solana CLI keypairs (64-byte secret arrays). The auditor must be registered
# on Umbra first (run the private-payments example's Register step with that key).
mkdir -p .keys
cp /path/to/subject.json .keys/subject.json
cp /path/to/auditor.json .keys/auditor.json

pnpm demo
```

Both keypairs need a little devnet SOL (the grant issue/revoke are MPC transactions):
fund them at https://faucet.umbraprivacy.com/.

## Install

`@umbra-privacy/sdk@5.0.0-rc.6` is self-contained — it pins
`@umbra-privacy/umbra-codama@3.0.0-rc.6`, so no package-manager override and no dist
patch are needed (the earlier rc.3/rc.4 codama and `scan()` workarounds are fixed in
rc.6). Just `pnpm install`.

## Links

- Docs: https://sdk.umbraprivacy.com/
- SDK on npm: https://www.npmjs.com/package/@umbra-privacy/sdk
