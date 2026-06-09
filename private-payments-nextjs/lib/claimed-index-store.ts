// Per-wallet IndexedDB-backed set of Stealth-Pool-Note ids that have
// been burnt. Prevents redundant burn attempts when the indexer hasn't
// yet caught up with the on-chain nullifier burn (typical 1–2 block
// lag).
//
// In V18 the SDK also offers a built-in `nullifierStore` adapter that
// tracks the burn lifecycle natively (`createShardedNullifierStore`
// from `@umbra-privacy/sdk/store-adapters`, wired up in
// `lib/umbra-client.ts`). This file is the lightweight session-local
// shortcut used by the UI for "have I queued this Note for burn?"
// filtering — independent of the canonical nullifier store.

const DB_NAME = "umbra-burnt-notes";
const STORE = "burnt";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadBurnt(wallet: string): Promise<Set<string>> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(wallet);
    req.onsuccess = () => resolve(new Set((req.result as string[] | undefined) ?? []));
    req.onerror = () => reject(req.error);
  });
}

export async function addBurnt(wallet: string, noteIds: readonly string[]): Promise<void> {
  if (noteIds.length === 0) return;
  const existing = await loadBurnt(wallet);
  for (const id of noteIds) existing.add(id);
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put([...existing], wallet);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function filterUnburnt<T extends { id: string }>(
  notes: readonly T[],
  burnt: ReadonlySet<string>,
): T[] {
  return notes.filter((n) => !burnt.has(n.id));
}

// Clear the local burnt-index for a wallet. Use when a note was recorded as
// burnt locally but you want the scanner to resurface it (e.g. a burn that
// the relayer reported but you want to re-verify / re-attempt).
export async function clearBurnt(wallet: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(wallet);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
