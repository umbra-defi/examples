// Per-circuit ZK provers. We instantiate each prover lazily and reuse it.
// Default asset provider is the Umbra public CDN — see advanced.md §5
// for self-hosted options + Web Worker (comlink) integration.
//
// Performance: 2–8s in browser (WebAssembly), 1–3s in Node. The current
// scaffold runs the prover on the main thread for simplicity; for
// production, wrap in a Web Worker via comlink (advanced.md §5).
//
// Naming: BURNER prover factories use the wire-protocol `getClaim*ClaimableUtxo*`
// spellings; CREATOR prover factories use `getETA/ATAIntoStealthPoolNoteCreatorProver`.
// All identifiers here are the actual exports from `@umbra-privacy/sdk/zk-prover`.
//
// Each factory takes a `ZkProverDeps` ({ clock, logger, fetch, assetProvider?, ... }).
// `getDefaultZkProverDeps()` supplies the runtime deps (and a default CDN asset
// provider); we override `assetProvider` with an explicit CDN provider so the
// asset source is obvious and easy to swap for a self-hosted one.

import {
  getDefaultZkProverDeps,
  getCdnZkAssetProvider,
  getATAIntoStealthPoolNoteCreatorProver,
  getETAIntoStealthPoolNoteCreatorProver,
  getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getClaimSelfClaimableUtxoIntoPublicBalanceProver,
  getUserRegistrationProver,
} from "@umbra-privacy/sdk/zk-prover";

const assetProvider = getCdnZkAssetProvider();

const deps = { ...getDefaultZkProverDeps(), assetProvider };

// Burner-side provers (wire-protocol "Claim*ClaimableUtxo*" names).
export const burnReceiverIntoEncryptedProver = getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(deps);
export const burnSelfIntoPublicProver        = getClaimSelfClaimableUtxoIntoPublicBalanceProver(deps);

// Create-side provers (used by deposit/* creator factories).
// One prover instance covers BOTH self-burnable and receiver-burnable variants of the same source.
export const createFromPublicProver    = getATAIntoStealthPoolNoteCreatorProver(deps);   // ATA-source (self + receiver)
export const createFromEncryptedProver = getETAIntoStealthPoolNoteCreatorProver(deps);   // ETA-source (self + receiver)

// Registration prover.
export const registrationProver = getUserRegistrationProver(deps);
