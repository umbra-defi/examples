"use client";

// Step 1 — Registration + key rotation.
//
// Registration itself is handled by <RegistrationGate> (3-step, idempotent,
// resumable; auto-detects keys derived from a different master seed and offers
// a restore). Once registered, this page also exposes an explicit
// KEY-ROTATION / RE-KEY action:
//
//   getRestoreKeyConsistencyFunction — re-registers the on-chain encryption
//   keys (user X25519 sync tx + MVK/commitment via MPC+ZK) to match THIS
//   wallet's current master-seed derivation. This is the wallet-app form of
//   "rotate keys to the new version": after an SDK master-seed scheme change
//   (the signed message changes → a new seed) or a suspected viewing-key drift,
//   rotate the on-chain keys to the freshly-derived ones. See SKILL.md
//   "/account rotator functions" + advanced.md §3.

import { useState } from "react";
import Link from "next/link";
import {
  getRestoreKeyConsistencyFunction,
  verifyKeyConsistency,
} from "@umbra-privacy/sdk/validation";
import { Nav } from "@/components/Nav";
import { WalletButton } from "@/components/WalletButton";
import { RegistrationGate } from "@/components/RegistrationGate";
import { ConvertToShared } from "@/components/ConvertToShared";
import { DebugPanel } from "@/components/DebugPanel";
import { useUmbraSession } from "@/app/providers";
import { registrationProver } from "@/lib/zk-prover";
import { SUPPORTED_MINTS } from "@/lib/supported-mints";
import { env } from "@/lib/env";

// dUSDC/dUSDT aren't on the SDK's default devnet supported list, so pass the
// app's mints explicitly or the rotation skips them (see RegistrationGate).
const APP_MINTS = SUPPORTED_MINTS.filter(
  (m) => m.network === env.NEXT_PUBLIC_NETWORK,
).map((m) => m.mint as never);

function KeyRotationPanel() {
  const { client } = useUmbraSession();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    if (!client) return;
    setBusy(true);
    setError(null);
    setNotice("Rotating on-chain keys to this wallet's current seed (sync tx + MPC/ZK, ~10–30s)…");
    try {
      const restore = getRestoreKeyConsistencyFunction(
        { client },
        { zkProver: registrationProver },
      );
      const result = await restore({ includeUserCommitment: true, additionalMints: APP_MINTS });
      if (!result.allRestored) {
        const failed = result.failures.map((f) => f.field).join(", ");
        throw new Error(`Rotation failed for: ${failed || "unknown"}.`);
      }
      const verification = await verifyKeyConsistency({
        client,
        includeUserCommitment: true,
        additionalMints: APP_MINTS,
      });
      setNotice(
        verification.allConsistent
          ? "✓ Keys rotated — on-chain keys now match this wallet's current seed."
          : `Rotated, but still inconsistent: ${verification.mismatches.map((m) => m.field).join(", ")}`,
      );
    } catch (e: unknown) {
      setNotice(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Key rotation / re-key</h2>
      <p className="muted">
        Re-register your on-chain encryption keys to match this wallet&apos;s current master
        seed. Use after an SDK master-seed scheme change or a suspected viewing-key drift.
        Runs the user-key (sync) + MVK/commitment (MPC + ZK) rotators.
      </p>
      <button className="secondary" onClick={() => void rotate()} disabled={busy}>
        {busy ? "Rotating…" : "Rotate keys to current version"}
      </button>
      {notice && <p className="muted">{notice}</p>}
      {error && <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>}
    </div>
  );
}

export default function RegisterPage() {
  const { selectedAccount } = useUmbraSession();
  return (
    <>
      <Nav active="register" />
      <h1>1 · Register &amp; key rotation</h1>
      <p className="muted">
        One-time Umbra registration (account init, X25519 key, user commitment). Already
        registered with keys from a different seed? The gate offers a restore. You can also
        rotate keys manually below.
      </p>
      <WalletButton />
      <RegistrationGate>
        <div className="card">
          <h2>Registered ✓</h2>
          <p className="mono">{selectedAccount?.address}</p>
          <p>Next: fund your encrypted balance.</p>
          <Link href="/deposit">Go to Deposit →</Link>
        </div>
        <KeyRotationPanel />
        <ConvertToShared />
        <DebugPanel />
      </RegistrationGate>
    </>
  );
}
