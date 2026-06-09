"use client";

// Blocks children until the connected wallet is FULLY registered on Umbra.
// Full registration requires THREE flags on-chain:
//   - isInitialised                       (step 1: account init)
//   - isUserAccountX25519KeyRegistered    (step 2: confidential — X25519 key)
//   - isUserCommitmentRegistered          (step 3: anonymous — Groth16 commitment)
//
// Checking only `isInitialised` is a footgun: if a previous run got stuck
// after step 1, the gate would mark the wallet "registered" and skip
// steps 2+3, breaking every downstream Stealth-Pool-Note flow.
//
// Registration is idempotent + resumable — we always call register() and
// the SDK skips already-completed steps. After the call we re-query and
// require all three flags before unblocking.

import { useEffect, useState, type ReactNode } from "react";
import { getUserRegistrationFunction } from "@umbra-privacy/sdk/registration";
import { getUserAccountQuerierFunction } from "@umbra-privacy/sdk/query";
import { getRestoreKeyConsistencyFunction, verifyKeyConsistency } from "@umbra-privacy/sdk/validation";
import { isKeyConsistencyError } from "@umbra-privacy/sdk";
import { useUmbraSession } from "@/app/providers";
import { registrationProver } from "@/lib/zk-prover";
import { SUPPORTED_MINTS } from "@/lib/supported-mints";
import { env } from "@/lib/env";
import { VaultBalances } from "@/components/VaultBalances";

// Mints to include in EVERY key-consistency check + restore.
//
// CRITICAL: the SDK's getSupportedMints(network) — the default list
// verifyKeyConsistency / restore iterate — only contains wSOL on devnet. It
// does NOT include dUSDC / dUSDT, the very mints this app + the faucet use. So
// without passing them as `additionalMints`, the gate's consistency check
// silently skips dUSDC: a wallet whose dUSDC ETA carries a stale X25519 key
// (created under an older master seed) reads "consistent", slips into the app,
// and then every dUSDC shield/transfer fails the on-chain key check — and the
// restore flow never re-encrypts that token account either. Passing the app's
// own mints here closes both gaps.
const APP_MINTS = SUPPORTED_MINTS.filter(
  (m) => m.network === env.NEXT_PUBLIC_NETWORK,
).map((m) => m.mint as never);

type State = "loading" | "needs-registration" | "needs-restore" | "registered" | "error";

interface RegFlags {
  isInitialised: boolean;
  hasX25519: boolean;
  hasCommitment: boolean;
}

function flagsFromQuery(result: { state: string; data?: Record<string, unknown> }): RegFlags {
  const d = result.data ?? {};
  return {
    isInitialised: result.state === "exists" && Boolean(d.isInitialised),
    hasX25519: Boolean(d.isUserAccountX25519KeyRegistered),
    hasCommitment: Boolean(d.isUserCommitmentRegistered),
  };
}

function fullyRegistered(f: RegFlags): boolean {
  return f.isInitialised && f.hasX25519 && f.hasCommitment;
}

function describeMissing(f: RegFlags): string {
  const missing: string[] = [];
  if (!f.isInitialised) missing.push("account init");
  if (!f.hasX25519) missing.push("X25519 key registration");
  if (!f.hasCommitment) missing.push("user commitment registration");
  return missing.join(", ");
}

export function RegistrationGate({ children }: { children: ReactNode }) {
  const { client, selectedAccount } = useUmbraSession();
  const [state, setState] = useState<State>("loading");
  const [flags, setFlags] = useState<RegFlags | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !selectedAccount) {
      setState("loading");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const querier = getUserAccountQuerierFunction({ client });
        const result = await querier(selectedAccount.address as never);
        if (cancelled) return;
        const f = flagsFromQuery(result as never);
        setFlags(f);
        if (!fullyRegistered(f)) {
          setState("needs-registration");
          return;
        }
        // Registered flags alone are NOT enough: a wallet can be fully
        // registered with on-chain keys derived from a DIFFERENT master seed
        // (older SDK build / another app). Those flags read "registered" but
        // every deposit / note-create then fails the on-chain key-consistency
        // check. Verify local↔on-chain consistency before unblocking; if it
        // mismatches, route to the restore flow instead of into the app.
        const verification = await verifyKeyConsistency({
          client,
          includeUserCommitment: true,
          additionalMints: APP_MINTS,
        });
        if (cancelled) return;
        setState(verification.allConsistent ? "registered" : "needs-restore");
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selectedAccount]);

  async function register() {
    if (!client || !selectedAccount) return;
    setRegistering(true);
    setError(null);
    setNotice(null);
    try {
      const fn = getUserRegistrationFunction(
        { client },
        { zkProver: registrationProver },
      );

      let signatures: readonly unknown[];
      try {
        signatures = (await fn({ confidential: true, anonymous: true })) as readonly unknown[];
      } catch (e: unknown) {
        // This wallet already has an Umbra account whose on-chain X25519 / MVK
        // keys were derived from a DIFFERENT master seed (e.g. registered by an
        // older SDK build or another app). register() refuses to silently
        // overwrite them and throws KeyConsistencyError. The sanctioned fix is
        // to re-register the on-chain keys to match THIS wallet's
        // freshly-derived seed (signed with UMBRA_MESSAGE_TO_SIGN), then retry.
        if (!isKeyConsistencyError(e)) throw e;

        setNotice(
          "Existing on-chain keys don't match this wallet's seed — restoring them " +
            "to match (MPC + ZK proof, ~10–30s). You may see a signature prompt.",
        );
        const restore = getRestoreKeyConsistencyFunction(
          { client },
          { zkProver: registrationProver },
        );
        const restoreResult = await restore({
          includeUserCommitment: true,
          additionalMints: APP_MINTS,
        });
        console.info("[Umbra] restoreKeyConsistency:", restoreResult);
        if (!restoreResult.allRestored) {
          const failed = restoreResult.failures.map((f) => f.field).join(", ");
          throw new Error(
            `Key restoration failed for: ${failed || "unknown"}. ` +
              "The on-chain keys could not be rotated to match this wallet.",
          );
        }

        setNotice("Keys restored. Completing registration…");
        // Keys now match local derivation — re-run registration to fill any
        // remaining sub-step (idempotent; skips already-consistent steps).
        signatures = (await fn({ confidential: true, anonymous: true })) as readonly unknown[];
      }

      console.info(
        `[Umbra] register({confidential, anonymous}) returned ${signatures.length} signature(s):`,
        signatures,
      );

      // Re-query to confirm ALL three flags actually landed. The SDK's
      // register() returns Signature[] of length 0–3 and skips
      // already-complete steps; we never trust the call alone.
      const querier = getUserAccountQuerierFunction({ client });
      const after = await querier(selectedAccount.address as never);
      const f = flagsFromQuery(after as never);
      setFlags(f);
      if (fullyRegistered(f)) {
        setNotice(null);
        setState("registered");
      } else {
        setError(
          `Registration incomplete — still missing: ${describeMissing(f)}. Click Register again.`,
        );
        setState("needs-registration");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  }

  // Restore on-chain keys to match THIS wallet's locally-derived seed. Used
  // when the wallet is fully registered but its on-chain keys came from a
  // different seed (verified on mount → "needs-restore"). Rotates the token
  // key (sync tx) + MVK/commitment (MPC + ZK) to the current seed.
  async function restoreKeys() {
    if (!client || !selectedAccount) return;
    setRegistering(true);
    setError(null);
    setNotice(
      "Restoring on-chain keys to match this wallet (MPC + ZK proof, ~10–30s). " +
        "You may see a signature prompt.",
    );
    try {
      const restore = getRestoreKeyConsistencyFunction(
        { client },
        { zkProver: registrationProver },
      );
      const result = await restore({
        includeUserCommitment: true,
        additionalMints: APP_MINTS,
      });
      console.info("[Umbra] restoreKeyConsistency:", result);
      if (!result.allRestored) {
        const failed = result.failures.map((f) => f.field).join(", ");
        throw new Error(
          `Key restoration failed for: ${failed || "unknown"}. ` +
            "The on-chain keys could not be rotated to match this wallet.",
        );
      }
      // Confirm consistency before unblocking.
      const verification = await verifyKeyConsistency({
        client,
        includeUserCommitment: true,
        additionalMints: APP_MINTS,
      });
      if (verification.allConsistent) {
        setNotice(null);
        setState("registered");
      } else {
        setError(
          "Keys still inconsistent after restore: " +
            verification.mismatches.map((m) => m.field).join(", "),
        );
      }
    } catch (e: unknown) {
      if (isKeyConsistencyError(e)) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setRegistering(false);
    }
  }

  if (!client || !selectedAccount) {
    return <p className="muted">Connect a wallet to continue.</p>;
  }
  if (state === "loading") return <p className="muted">Checking registration…</p>;
  if (state === "error") return <p className="error">{error}</p>;
  if (state === "needs-registration") {
    return (
      <div className="card">
        <h2>Register on Umbra</h2>
        <p>
          One-time setup. Three sub-steps: account init, X25519 key registration,
          user commitment registration. The SDK runs all three and skips any already
          complete — you may see up to three transaction prompts.
        </p>
        {flags && (
          <ul className="muted">
            <li>{flags.isInitialised ? "✓" : "◯"} Account init</li>
            <li>{flags.hasX25519 ? "✓" : "◯"} X25519 key registration</li>
            <li>{flags.hasCommitment ? "✓" : "◯"} User commitment registration</li>
          </ul>
        )}
        <button onClick={() => void register()} disabled={registering}>
          {registering ? "Registering…" : "Register"}
        </button>
        {notice && <p className="muted">{notice}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  if (state === "needs-restore") {
    return (
      <div className="card">
        <h2>Restore your Umbra keys</h2>
        <p>
          This wallet is registered, but its on-chain encryption keys were derived
          from a different master seed (e.g. an older app version). Until they are
          restored, deposits and note transfers will fail with a key-mismatch error.
        </p>
        <p className="muted">
          Restoring re-registers the on-chain keys to match this wallet&apos;s current
          seed (signed with the standard Umbra message). One sync transaction for the
          token key, plus an MPC + ZK step for the viewing-key commitment.
        </p>
        <button onClick={() => void restoreKeys()} disabled={registering}>
          {registering ? "Restoring…" : "Restore keys"}
        </button>
        {notice && <p className="muted">{notice}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  // Registered + key-consistent → show the vault dashboard above every tab's content.
  return (
    <>
      <VaultBalances />
      {children}
    </>
  );
}
