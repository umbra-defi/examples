"use client";

// Key-consistency status (NO background scan loop).
//
// Previously this ran getBurnableStealthPoolNoteScannerFunction on a 12s
// interval, which hammered the indexer (/proxy/indexer/v1/trees) and devnet RPC
// (getMultipleAccounts) nonstop. Scanning is now MANUAL — the Claim page scans
// on mount + on its Refresh button (the single source of truth for notes). This
// component only runs the one-shot key-consistency check, which tells you if
// notes sent to you are encrypted to a key you can no longer derive.
//
// Critical rule 6: the scan (on the Claim page) uses the CONNECTED wallet's signer.

import { useEffect, useRef, useState } from "react";
import { useUmbraSession } from "@/app/providers";
import { dumpKeyConsistency, dumpUserAccount, type KeyConsistencySummary } from "@/lib/umbra-debug";

export function useKeyConsistency() {
  const { client, selectedAccount } = useUmbraSession();
  const [keyConsistency, setKeyConsistency] = useState<KeyConsistencySummary | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!client || !selectedAccount) return;
    stoppedRef.current = false;
    setKeyConsistency(null);
    void (async () => {
      const ks = await dumpKeyConsistency(client, "scanner wallet");
      if (!stoppedRef.current) setKeyConsistency(ks);
      await dumpUserAccount(client, selectedAccount.address, "scanner wallet");
    })();
    return () => {
      stoppedRef.current = true;
    };
  }, [client, selectedAccount]);

  return { keyConsistency };
}

export function ScanWorkerStatus() {
  const { keyConsistency } = useKeyConsistency();
  if (keyConsistency && !keyConsistency.allConsistent) {
    return (
      <p className="error" style={{ whiteSpace: "pre-wrap" }}>
        ⚠ Key mismatch on: {keyConsistency.mismatches.join(", ")}. Notes sent to you are
        encrypted to a key you can no longer derive — run “Rotate keys” on the Register tab,
        then Refresh.
      </p>
    );
  }
  return null;
}
