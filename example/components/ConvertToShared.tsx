"use client";

// Convert an EncryptedTokenAccount from NETWORK (MXE-only) mode to SHARED mode.
//
// An ETA created in network mode encrypts its balance under the MXE network's
// key, not yours. Consequences:
//   - its on-chain X25519 key matches neither your user-account key nor the
//     per-mint key → "token account X25519 key does not match…" on shield;
//   - you can't decrypt the balance client-side, and shared-balance ops
//     (shield / withdraw / receive-into-ETA) reject it.
//
// getNetworkEncryptionToSharedEncryptionConverterFunction re-encrypts the
// balance under your shared key (one-way, per mint, MPC). It needs no ZK prover
// and no relayer, and — unlike the ETA→ETA transfer — does NOT read the MXE's
// utility pubkey, so it works on devnet even while transfers don't. Mints that
// are already shared / uninitialised are skipped with a reason, so running this
// can't damage a correctly-configured account.

import { useState } from "react";
import { getNetworkEncryptionToSharedEncryptionConverterFunction } from "@umbra-privacy/sdk/conversion";
import { useUmbraSession } from "@/app/providers";
import { env } from "@/lib/env";
import { findMint } from "@/lib/supported-mints";
import { formatSdkErrorString } from "@/lib/format-error";
import { dbg } from "@/lib/umbra-debug";

const SKIP_LABELS: Record<string, string> = {
  non_existent: "no encrypted account exists for this mint yet — nothing to convert",
  not_initialised: "encrypted account not initialised",
  already_shared: "already in shared mode — nothing to do ✓",
  balance_not_initialised: "no encrypted balance yet — shield something into it first",
};

export function ConvertToShared() {
  const { client, selectedAccount } = useUmbraSession();
  const [mint, setMint] = useState(env.NEXT_PUBLIC_DEFAULT_MINT);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const network = env.NEXT_PUBLIC_NETWORK as "mainnet-beta" | "devnet";

  async function convert() {
    if (!client || !selectedAccount) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      dbg("convert", `network→shared for mint ${mint}`, { mint });
      const convertToShared = getNetworkEncryptionToSharedEncryptionConverterFunction({ client });
      const res = await convertToShared([mint as never]);
      dbg("convert", "convert done", {
        converted: [...res.converted.entries()].map(([m, s]) => ({ mint: String(m), sig: String(s) })),
        skipped: [...res.skipped.entries()].map(([m, r]) => ({ mint: String(m), reason: r })),
      });

      // Match by string value (Map keys are branded Address).
      const sig = [...res.converted.entries()].find(([m]) => String(m) === mint)?.[1];
      const skip = [...res.skipped.entries()].find(([m]) => String(m) === mint)?.[1];
      if (sig) {
        setResult(`Converted to shared mode ✓\n${String(sig)}`);
      } else if (skip) {
        setResult(`Skipped: ${SKIP_LABELS[skip] ?? skip}`);
      } else {
        setResult("No change reported for this mint.");
      }
    } catch (e: unknown) {
      const msg = formatSdkErrorString(e);
      console.error("Umbra convert-to-shared failed:", msg);
      dbg("convert", "convert FAILED", e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Fix encrypted-balance mode</h2>
      <p className="muted">
        If your encrypted account for a mint was created in <strong>network (MXE-only)</strong> mode,
        you can&apos;t shield into it or decrypt its balance, and its on-chain key won&apos;t match
        your wallet (&ldquo;token account X25519 key does not match…&rdquo;). Convert it to{" "}
        <strong>shared</strong> mode — one-way, per mint. Already-shared accounts are skipped, so this
        is safe to run.
      </p>
      <label>Mint</label>
      <input value={mint} onChange={(e) => setMint(e.target.value)} spellCheck={false} />
      <p className="muted">{findMint(mint, network)?.symbol ?? "(unsupported)"}</p>
      <button onClick={() => void convert()} disabled={busy || !mint}>
        {busy ? "Converting… (MPC, ~10–30s)" : "Convert to shared mode"}
      </button>
      {result && <p className="mono" style={{ whiteSpace: "pre-wrap" }}>{result}</p>}
      {error && <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>}
    </div>
  );
}
