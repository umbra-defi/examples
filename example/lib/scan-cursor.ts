// V18: this file is intentionally empty.
//
// The V18 scanner (`getBurnableStealthPoolNoteScannerFunction`) is
// zero-arg and manages per-(network, signer, treeIndex) cursor
// progress internally via `client.utxoDataStore`. There is no caller-
// side cursor to persist — the IndexedDB-backed cursor previously
// maintained here is replaced by the encrypted-sharded
// `createShardedUtxoDataStore` adapter from
// `@umbra-privacy/sdk/store-adapters`, which is wired up in
// `lib/umbra-client.ts`.
//
// Keeping this file as a stub so existing imports don't break during
// migration. New code should not import from here.

export {};
