"use client";

// Receive flow — scan + burn with the production-grade batching pattern:
//
//   1. V18 scanner is zero-arg and returns four note categories:
//      etaIntoReceiverBurnable, ataIntoReceiverBurnable,
//      etaIntoSelfBurnable, ataIntoSelfBurnable.
//   2. Filter out notes already in our local burnt-index store (avoids
//      redundant relayer calls when the indexer hasn't yet caught up
//      with the on-chain nullifier burn).
//   3. Burn service groups by type, batches receiver-into-encrypted in
//      chunks of 4, burns self-into-PATA one-at-a-time, and falls back
//      to single-note burn on `NullifierAlreadyBurnt` to avoid losing a
//      whole batch to one stale note.
//   4. After each successful burn, persist the noteId to the burnt-index
//      store so subsequent scans skip it.
//
// Critical rules:
//   - 6: scanner uses the connected wallet's signer (handled by ScanWorker).
//   - 8: scanner is zero-arg; cursor is managed by client.utxoDataStore.
//   - 3: burn is idempotent — DUPLICATE_OFFSET / NullifierAlreadyBurnt
//     treated as success.
//
// Note: V18 has NO receiver-into-PATA burner factory yet; the
// `ataIntoReceiverBurnable` bucket is shown
// in the UI as "not yet claimable in V18" until the SDK ships that
// pipeline. The other three buckets are fully wired below.
//
// Privacy note (privacy.md): receive UI is MANUAL — no auto-burn.

import { useState } from "react";
import { address, getAddressDecoder } from "@solana/kit";
import { getBurnableStealthPoolNoteScannerFunction } from "@umbra-privacy/sdk/burn";
import { env, umbraNetwork } from "@/lib/env";
import { findMint } from "@/lib/supported-mints";
import { Nav } from "@/components/Nav";
import { WalletButton } from "@/components/WalletButton";
import { RegistrationGate } from "@/components/RegistrationGate";
import { PrivacyTierBadge } from "@/components/PrivacyTierBadge";
import { ScanWorkerStatus } from "@/components/ScanWorker";
import { DebugPanel } from "@/components/DebugPanel";
import { useUmbraSession } from "@/app/providers";
import { formatSdkErrorString } from "@/lib/format-error";
import { dbg } from "@/lib/umbra-debug";
import { burnBatch, type BurnableNote, type BurnResult } from "@/lib/claim-service";
import {
  loadBurnt,
  addBurnt,
  clearBurnt,
  filterUnburnt,
} from "@/lib/claimed-index-store";

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// ---- decode the human-readable fields off a DecryptedStealthPoolNoteData ----
const addrDecoder = getAddressDecoder();
function u128le(v: bigint): Uint8Array {
  const b = new Uint8Array(16);
  let x = v;
  for (let i = 0; i < 16; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
}
// A Solana address is split across the note as two little-endian U128 halves.
function reassembleAddress(low?: bigint, high?: bigint): string | null {
  if (low === undefined || high === undefined) return null;
  try {
    const bytes = new Uint8Array(32);
    bytes.set(u128le(BigInt(low)), 0);
    bytes.set(u128le(BigInt(high)), 16);
    return addrDecoder.decode(bytes);
  } catch {
    return null;
  }
}
interface NoteDetail {
  amount: string;
  symbol: string;
  mint: string | null;
  sender: string | null;
  destination: string | null;
  source?: string;
  treeIndex?: string;
  leafIndex?: string; // = insertionIndex within the tree
  commitmentIndex?: string;
}
// DecryptedStealthPoolNoteData: amount/destinationAddress/treeIndex/insertionIndex
// are top-level; sender + mint + commitmentIndex live in `h1Components` as U128
// little-endian halves (low = address bytes[0..16], high = bytes[16..32]).
function describeNote(raw: unknown): NoteDetail {
  const n = raw as {
    amount?: bigint;
    destinationAddress?: string;
    treeIndex?: number | bigint;
    insertionIndex?: number | bigint;
    source?: string;
    h1Components?: {
      mintAddressLow?: bigint; mintAddressHigh?: bigint;
      senderAddressLow?: bigint; senderAddressHigh?: bigint;
      commitmentIndex?: bigint;
    };
  };
  const h1 = n.h1Components ?? {};
  const mint = reassembleAddress(h1.mintAddressLow, h1.mintAddressHigh);
  const meta = mint ? findMint(mint, env.NEXT_PUBLIC_NETWORK as "mainnet-beta" | "devnet") : undefined;
  const decimals = meta?.decimals ?? 6;
  const amountRaw = n.amount !== undefined ? BigInt(n.amount) : 0n;
  const d = BigInt(10) ** BigInt(decimals);
  const frac = (amountRaw % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return {
    amount: `${amountRaw / d}${frac ? "." + frac : ""}`,
    symbol: meta?.symbol ?? (mint ? "tokens" : "tokens"),
    mint,
    sender: reassembleAddress(h1.senderAddressLow, h1.senderAddressHigh),
    destination: n.destinationAddress ?? null,
    source: n.source,
    treeIndex: n.treeIndex !== undefined ? String(n.treeIndex) : undefined,
    leafIndex: n.insertionIndex !== undefined ? String(n.insertionIndex) : undefined,
    commitmentIndex: h1.commitmentIndex !== undefined ? String(h1.commitmentIndex) : undefined,
  };
}

interface ScannedSummary {
  receiver: BurnableNote[];
  selfBurnable: BurnableNote[];
  rawReceiver: number;                     // found by the scanner, before local burnt-cache filter
  rawSelf: number;
  pendingReceiverIntoPATA: number;        // V18 has no burner for this bucket
  total: number;
}

export default function ReceivePage() {
  const { client, selectedAccount } = useUmbraSession();
  const [burning, setBurning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scanned, setScanned] = useState<ScannedSummary | null>(null);
  const [results, setResults] = useState<readonly BurnResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!client || !selectedAccount) return;
    setRefreshing(true);
    setError(null);
    setResults(null);
    try {
      // V18: zero-arg scanner. It discovers trees, advances the per-tree cursor
      // in client.utxoDataStore (the STANDARD createShardedUtxoDataStore, wired in
      // lib/umbra-client.ts), and PUTs every decrypted note into that store.
      const scan = getBurnableStealthPoolNoteScannerFunction({ client });
      await scan();

      const burnt = await loadBurnt(selectedAccount.address);

      // Read the FULL set of known notes from the store — not just this scan's
      // delta. The standard sharded store keeps every discovered note, so notes
      // survive reloads and incremental re-scans (no watermark workaround needed).
      const store = client.utxoDataStore;
      const entries = store
        ? await store.query({ network: umbraNetwork(), signerAddress: address(selectedAccount.address) })
        : [];

      // claimType → burn route:
      //   - etaToStealthPoolReceiverBurnable → receiver burner (→ ETA)
      //   - etaToStealthPoolSelfBurnable / ataToStealthPoolSelfBurnable → self burner
      //   - ataToStealthPoolReceiverBurnable → NO burner in V18 yet (shown as pending)
      const toBurnable = (
        entry: { utxoKey?: string; treeIndex?: bigint; insertionIndex?: bigint; data: unknown },
        type: "receiver" | "self",
      ): BurnableNote => {
        const id =
          entry.treeIndex !== undefined && entry.insertionIndex !== undefined
            ? `${entry.treeIndex}:${entry.insertionIndex}`
            : String(entry.utxoKey ?? `unknown:${Math.random().toString(36).slice(2)}`);
        return { raw: entry.data, id, type };
      };

      const receiverEntries = entries.filter(
        (e) => e.claimType === "etaToStealthPoolReceiverBurnable",
      );
      const selfEntries = entries.filter(
        (e) =>
          e.claimType === "etaToStealthPoolSelfBurnable" ||
          e.claimType === "ataToStealthPoolSelfBurnable",
      );
      const pendingReceiverIntoPATA = entries.filter(
        (e) => e.claimType === "ataToStealthPoolReceiverBurnable",
      ).length;

      const receiver = filterUnburnt(receiverEntries.map((e) => toBurnable(e, "receiver")), burnt);
      const selfBurnable = filterUnburnt(selfEntries.map((e) => toBurnable(e, "self")), burnt);

      setScanned({
        receiver,
        selfBurnable,
        rawReceiver: receiverEntries.length,
        rawSelf: selfEntries.length,
        pendingReceiverIntoPATA,
        total: receiver.length + selfBurnable.length,
      });
      dbg(
        "receive",
        `scan + store-query → ${receiver.length} receiver + ${selfBurnable.length} self-burnable ` +
          `(store holds ${entries.length}; ${burnt.size ?? "?"} already-burnt filtered)`,
        {
          storeEntries: entries.length,
          receiverEntries: receiverEntries.length,
          selfEntries: selfEntries.length,
          pendingReceiverIntoPATA,
        },
      );
    } catch (e: unknown) {
      const msg = formatSdkErrorString(e);
      console.error("Umbra scan failed:", msg);
      dbg("receive", "manual refresh FAILED", e);
      setError(msg);
    } finally {
      setRefreshing(false);
    }
  }

  // Scanning is MANUAL — the user clicks "Scan" (no auto-scan on mount, no
  // background polling). This keeps devnet RPC load minimal.

  async function burn(group: "receiver" | "self" | "all") {
    if (!client || !selectedAccount || !scanned) return;
    setBurning(true);
    setError(null);
    setResults(null);
    try {
      const notes =
        group === "receiver"
          ? scanned.receiver
          : group === "self"
            ? scanned.selfBurnable
            : [...scanned.receiver, ...scanned.selfBurnable];
      if (notes.length === 0) {
        setError("Nothing to burn in that group.");
        return;
      }
      const out = await burnBatch(client, notes);
      setResults(out);

      // Persist the successfully-burnt ids so subsequent scans skip them.
      const burntIds = out.filter((r) => r.success).map((r) => r.noteId);
      if (burntIds.length > 0) {
        await addBurnt(selectedAccount.address, burntIds);
      }
      // Refresh to reflect the new burnt state.
      void refresh();
    } catch (e: unknown) {
      console.error("Umbra burn failed:", formatSdkErrorString(e));
      setError(formatSdkErrorString(e));
    } finally {
      setBurning(false);
    }
  }

  // Clear the local burnt-cache, then scan + re-query the store. Use when a note
  // you expect is hidden by the burnt-cache. The standard utxoDataStore retains
  // every discovered note, so this re-surfaces all unburnt notes. (It does NOT
  // un-burn an on-chain note; a genuinely burnt nullifier still no-ops on re-burn.)
  async function fullRescan() {
    if (!selectedAccount) return;
    await clearBurnt(selectedAccount.address);
    await refresh();
  }

  const recvCount = scanned?.receiver.length ?? 0;
  const selfCount = scanned?.selfBurnable.length ?? 0;
  const pendingPATA = scanned?.pendingReceiverIntoPATA ?? 0;
  const filteredOut =
    scanned ? scanned.rawReceiver + scanned.rawSelf - recvCount - selfCount : 0;

  return (
    <>
      <Nav active="claim" />
      <h1>Receive <PrivacyTierBadge tier={1} /></h1>
      <p className="muted">
        Scan runs on load and when you click <em>Refresh</em> (no background polling). Each scan
        returns your full note set. Clicking <em>Burn received → ETA</em> claims incoming
        receiver-claimable notes into your EncryptedTokenAccount (Tier&nbsp;1 — no link back to the
        sender); withdraw to a public balance any time on the Withdraw tab.
      </p>
      <WalletButton />
      <RegistrationGate>
        <div className="card">
          <ScanWorkerStatus />
          {!scanned && !refreshing && (
            <p className="muted">Click <strong>Scan</strong> to discover your notes.</p>
          )}
          {refreshing && <p className="muted">Scanning from your watermark…</p>}
          {scanned && (
            <p className="muted">
              Scanner found <strong>{scanned.rawReceiver}</strong> receiver-claimable +{" "}
              <strong>{scanned.rawSelf}</strong> self-claimable note(s).
              {filteredOut > 0 && (
                <>
                  {" "}
                  <span className="error">{filteredOut} hidden by the local burnt-cache</span> — if a
                  note you expect is missing, click <em>Full rescan (from start)</em>.
                </>
              )}
            </p>
          )}
          <p className="muted">
            <strong>Where claimed funds land:</strong> receiver-claimable → your{" "}
            <strong>shielded ETA</strong> (vault dashboard updates). Self-claimable → your{" "}
            <strong>public ATA</strong> (the &quot;Public (ATA)&quot; column, not the shielded one).
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => void refresh()} disabled={refreshing || burning}>
              {refreshing ? "Scanning…" : "Scan"}
            </button>
            <button onClick={() => void burn("receiver")} disabled={burning || recvCount === 0} className="secondary">
              {burning ? "Burning…" : `Burn received → ETA (${recvCount})`}
            </button>
            <button onClick={() => void burn("self")} disabled={burning || selfCount === 0} className="secondary">
              {burning ? "Burning…" : `Burn self → ATA (${selfCount})`}
            </button>
            <button onClick={() => void fullRescan()} disabled={refreshing || burning} className="secondary">
              Full rescan (from start)
            </button>
          </div>
          {scanned && (scanned.receiver.length > 0 || scanned.selfBurnable.length > 0) && (
            <>
              <h2>Scanned notes ({scanned.receiver.length + scanned.selfBurnable.length})</h2>
              {[...scanned.receiver, ...scanned.selfBurnable].map((note) => {
                const d = describeNote(note.raw);
                return (
                  <div key={note.id} className="card" style={{ marginTop: 8 }}>
                    <p className="mono">
                      <strong>{d.amount} {d.symbol}</strong> ·{" "}
                      {note.type === "receiver" ? "receiver-claimable → your ETA" : "self-claimable → your ATA"}
                    </p>
                    <p className="mono muted" style={{ fontSize: "0.85em" }}>
                      mint: {d.mint ? `${d.symbol} (${d.mint.slice(0, 4)}…${d.mint.slice(-4)})` : "—"}
                    </p>
                    {d.sender && (
                      <p className="mono muted" style={{ fontSize: "0.85em" }}>
                        from: {d.sender.slice(0, 6)}…{d.sender.slice(-6)}
                      </p>
                    )}
                    {d.destination && (
                      <p className="mono muted" style={{ fontSize: "0.85em" }}>
                        to: {d.destination.slice(0, 6)}…{d.destination.slice(-6)}
                      </p>
                    )}
                    <p className="mono muted" style={{ fontSize: "0.85em" }}>
                      tree {d.treeIndex ?? "?"} · leaf #{d.leafIndex ?? "?"} · commitment #{d.commitmentIndex ?? "?"}
                      {d.source ? ` · src ${d.source}` : ""}
                    </p>
                  </div>
                );
              })}
            </>
          )}
          {pendingPATA > 0 && (
            <p className="muted">
              <strong>{pendingPATA}</strong> receiver-into-PATA Note(s) detected.
              V18 has not yet shipped the SDK pipeline for this destination; the
              on-chain instruction exists but the burner factory is missing.
              These will be burnable once the SDK adds the
              `getReceiverBurnableStealthPoolNoteIntoATABurnerFunction (not yet shipped in SDK)`
              factory.
            </p>
          )}
          {error && <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>}
          {results && (
            <>
              <h2>Burn results</h2>
              {results.length === 0 && <p className="muted">No notes were burnt.</p>}
              {results.map((r, i) => (
                <div key={`${r.noteId}-${i}`} className="card" style={{ marginTop: 8 }}>
                  <p className="mono">
                    {r.success ? "✓ burnt" : "✗ failed"} · note {r.noteId}
                    {r.status && ` · status=${r.status}`}
                    {r.error && ` · ${r.error}`}
                  </p>
                  {r.requestId && <p className="mono muted">relayer request: {r.requestId}</p>}
                  {r.txSignature && (
                    <p className="mono">
                      claim queue (computation):{" "}
                      <a href={explorerTx(r.txSignature)} target="_blank" rel="noreferrer">{r.txSignature}</a>
                    </p>
                  )}
                  {r.callbackSignature && (
                    <p className="mono">
                      MPC callback (credits balance):{" "}
                      <a href={explorerTx(r.callbackSignature)} target="_blank" rel="noreferrer">{r.callbackSignature}</a>
                    </p>
                  )}
                  {r.success && !r.callbackSignature && !r.txSignature && (
                    <p className="muted">
                      (idempotent — note was already burnt on-chain; no new tx.)
                    </p>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="card">
          <h2>Privacy notes</h2>
          <ul>
            <li>Burning into your EncryptedTokenAccount keeps your identity hidden.</li>
            <li>Receiver-burnable timing breaks correlation: burn whenever you want.</li>
            <li>Withdrawing later to a PATA reveals only the withdrawal amount.</li>
            <li>This page does NOT auto-burn. Manual + delayed is the privacy-correct default.</li>
          </ul>
        </div>
        <DebugPanel />
      </RegistrationGate>
    </>
  );
}
