// Watermark scan cursor.
//
// Problem: with the SDK's normal incremental cursor, scan() returns only leaves
// found SINCE the last scan and advances the cursor to the tip — so a re-scan
// returns 0 and the UI loses unclaimed notes. Scanning from genesis every time
// is correct but wasteful.
//
// Solution (per the app design): store a single per-tree WATERMARK = the floor
// below which every note is already claimed. We expose a tiny UtxoDataStore that
// reports `[0, watermark-1]` as already-scanned, so the SDK scanner only scans
// `[watermark, tip)` — re-discovering every still-unclaimed note every time,
// while skipping the fully-claimed prefix. The scanner's own range writes are
// ignored (no-op); WE advance the watermark after claims via
// `updateWatermarksFromScan`. Persisted in localStorage, keyed by
// (network, signer, tree).

import type { UtxoDataStore } from "@umbra-privacy/sdk/store";

const PREFIX = "umbra-scan-watermark";
const wmKey = (network: string, signer: string, tree: string) =>
  `${PREFIX}:${network}:${signer}:${tree}`;

export function getWatermark(network: string, signer: string, treeIndex: bigint): bigint {
  try {
    const v = localStorage.getItem(wmKey(network, signer, treeIndex.toString()));
    return v ? BigInt(v) : 0n;
  } catch {
    return 0n;
  }
}

export function setWatermark(network: string, signer: string, treeIndex: bigint, value: bigint): void {
  try {
    localStorage.setItem(wmKey(network, signer, treeIndex.toString()), value.toString());
  } catch {
    /* storage unavailable — fall back to genesis scans */
  }
}

export function clearWatermarks(network: string, signer: string): void {
  try {
    const prefix = `${PREFIX}:${network}:${signer}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/**
 * A UtxoDataStore whose ONLY job is to steer where scan() starts, via the
 * persisted per-tree watermark. It does NOT persist notes (the UI reads them
 * straight off the scan() result) and IGNORES the scanner's own range writes.
 */
export function createWatermarkUtxoDataStore(): UtxoDataStore {
  const store = {
    put: async () => {},
    get: async () => null,
    query: async () => [],
    count: async () => 0,
    remove: async () => {},
    getScanProgress: async (network: string, signerAddress: string, treeIndex: bigint) => {
      const w = getWatermark(network, signerAddress, treeIndex);
      if (w <= 0n) return null; // scan from genesis
      // Report [0, w-1] as scanned → scanner scans the gap [w, tip).
      return { ranges: [{ start: 0n, end: w - 1n }], highWaterMark: w - 1n };
    },
    addScannedRange: async () => {}, // no-op — the app advances the watermark
  };
  return store as unknown as UtxoDataStore;
}

// Bucket keys on the scan result that carry decrypted notes (each has top-level
// treeIndex + insertionIndex).
const NOTE_BUCKETS = [
  "etaToStealthPoolReceiverBurnable",
  "etaToStealthPoolSelfBurnable",
  "ataToStealthPoolReceiverBurnable",
  "ataToStealthPoolSelfBurnable",
  "networkBalanceToStealthPoolReceiverBurnableWithEncryptedAddress",
  "networkBalanceToStealthPoolSelfBurnableWithEncryptedAddress",
] as const;

interface ScannedLike {
  scannedTrees: readonly { treeIndex: bigint | number; totalLeaves: bigint | number; fullyScanned: boolean }[];
  [bucket: string]: unknown;
}

/**
 * After a scan, advance each tree's watermark to the LOWEST insertion index that
 * is still unclaimed (everything below it is claimed → safe to skip next time).
 * If a fully-scanned tree has no unclaimed notes, jump the watermark to its leaf
 * count so future scans only see brand-new leaves. `burnt` is the local
 * burnt-note id set (id = `${treeIndex}:${insertionIndex}`).
 */
export function updateWatermarksFromScan(
  network: string,
  signer: string,
  fresh: ScannedLike,
  burnt: ReadonlySet<string>,
): void {
  const minUnclaimed = new Map<string, bigint>();
  for (const bucket of NOTE_BUCKETS) {
    const notes = (fresh[bucket] as readonly { treeIndex?: bigint | number; insertionIndex?: bigint | number }[]) ?? [];
    for (const n of notes) {
      if (n.treeIndex === undefined || n.insertionIndex === undefined) continue;
      const treeKey = String(n.treeIndex);
      const ins = BigInt(n.insertionIndex);
      const id = `${n.treeIndex}:${n.insertionIndex}`;
      if (burnt.has(id)) continue; // already claimed
      const cur = minUnclaimed.get(treeKey);
      if (cur === undefined || ins < cur) minUnclaimed.set(treeKey, ins);
    }
  }
  for (const t of fresh.scannedTrees) {
    const treeIndex = BigInt(t.treeIndex);
    const min = minUnclaimed.get(String(t.treeIndex));
    if (min !== undefined) {
      setWatermark(network, signer, treeIndex, min);
    } else if (t.fullyScanned) {
      setWatermark(network, signer, treeIndex, BigInt(t.totalLeaves));
    }
  }
}
