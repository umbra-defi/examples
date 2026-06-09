// Production-grade burn service.
//
// SDK terminology: the burn pipeline operates on Stealth Pool Notes.
// The wire protocol retains the legacy `claim` identifier (HTTP path
// `/v1/claims`, relayer methods `submitClaim` / `pollClaimStatus`) so
// the relayer's existing methods plug into the burner-factory `relayer`
// dep under the new property names `submitBurn` / `pollBurnStatus`.
// See SKILL.md "Naming conventions".
//
// Patterns (mirroring frontend-core/src/note/services/burn-note-service.ts):
//   - Group Notes by burn type (receiver vs self).
//   - Receiver into EncryptedTokenAccount: chunk into batches of 4,
//     burn sequentially.
//   - Self into PATA: burn one-at-a-time (no batching — MAX_NOTES_PER_PROOF = 1).
//   - On batch nullifier-burnt failure with multiple Notes, fall back
//     to single-Note burn per affected id (one bad nullifier shouldn't
//     fail the whole batch).
//   - "NullifierAlreadyBurnt" on a single-Note batch = treat as success
//     ("Note already burnt") — idempotent semantics.

import { getUmbraRelayer } from "@umbra-privacy/sdk";
import type { IUmbraClient } from "@umbra-privacy/sdk";
import {
  getReceiverBurnableStealthPoolNoteIntoETABurnerFunction,
  getSelfBurnableStealthPoolNoteIntoATABurnerFunction,
} from "@umbra-privacy/sdk/burn";
import {
  burnReceiverIntoEncryptedProver,
  burnSelfIntoPublicProver,
} from "@/lib/zk-prover";
import { formatSdkErrorString } from "@/lib/format-error";
import { env } from "@/lib/env";

export interface BurnableNote {
  raw: unknown;
  id: string;
  type: "receiver" | "self";
}

export interface BurnResult {
  noteId: string;
  success: boolean;
  signature: string; // back-compat: callbackSignature ?? txSignature
  txSignature?: string; // the burn / claim-queue (computation) tx
  callbackSignature?: string; // the Arcium MPC callback tx (credits the balance)
  requestId?: string; // relayer request id
  status?: string; // terminal batch status
  error?: string;
}

// Burn receiver notes ONE AT A TIME (not batched).
//
// The receiver burner groups same-destination notes into a single tx. The
// scanner returns already-burnt notes too (it doesn't check nullifiers), so a
// batch containing ONE already-burnt note reverts the WHOLE tx with
// `NullifierAlreadyBurnt` (err 28004) — and no fresh note in that batch lands.
// Proven on devnet: individual burns let stale notes fail harmlessly while the
// fresh ones claim and credit the ETA. (Batching is a throughput optimisation;
// for a payments app claiming a handful of notes, reliability wins.)
const BURN_BATCH_SIZE = 1;

interface BatchLike {
  status: string;
  requestId?: string;
  txSignature?: string;
  callbackSignature?: string;
  failureReason?: string | null;
  stealthPoolNoteIds?: readonly string[];
}

// Build a successful BurnResult carrying both the queue (computation) tx and
// the Arcium callback tx so the UI can display + link them.
function successResult(b: BatchLike, id: string): BurnResult {
  return {
    noteId: id,
    success: true,
    signature: batchSignature(b),
    txSignature: b.txSignature,
    callbackSignature: b.callbackSignature,
    requestId: b.requestId,
    status: b.status,
  };
}

function isBatchSuccessful(b: BatchLike): boolean {
  return b.status === "completed" || b.status === "callback_received";
}
function batchSignature(b: BatchLike): string {
  return b.callbackSignature ?? b.txSignature ?? "";
}
function batchError(b: BatchLike): string {
  if (b.failureReason?.includes("NullifierAlreadyBurnt")) return "Note already burnt";
  return `Burn ${b.status}`;
}

function groupByType(
  notes: readonly BurnableNote[],
): { receiver: BurnableNote[]; self: BurnableNote[] } {
  const receiver: BurnableNote[] = [];
  const self: BurnableNote[] = [];
  for (const n of notes) {
    (n.type === "receiver" ? receiver : self).push(n);
  }
  return { receiver, self };
}

function relayer() {
  return getUmbraRelayer({ apiEndpoint: env.NEXT_PUBLIC_RELAYER_URL });
}

async function burnReceiverChunk(
  client: IUmbraClient,
  chunk: readonly BurnableNote[],
): Promise<BurnResult[]> {
  if (!client.fetchBatchMerkleProof) {
    throw new Error(
      "client.fetchBatchMerkleProof unavailable — pass `indexerApiEndpoint` to getUmbraClient (NEXT_PUBLIC_INDEXER_URL).",
    );
  }
  const r = relayer();
  const burn = getReceiverBurnableStealthPoolNoteIntoETABurnerFunction(
    { client },
    {
      fetchBatchMerkleProof: client.fetchBatchMerkleProof,
      zkProver: burnReceiverIntoEncryptedProver,
      relayer: {
        // V18 burn-factory dep uses `submitBurn` / `pollBurnStatus`
        // property names; the underlying types are TS aliases of the
        // claim equivalents (see operations/burn/interfaces.ts:91-92),
        // so the relayer client's existing methods plug in directly.
        submitBurn:        r.submitClaim,
        pollBurnStatus:    r.pollClaimStatus,
        getRelayerAddress: r.getRelayerAddress,
      },
    },
  );

  const results: BurnResult[] = [];
  try {
    const out = await burn(chunk.map((n) => n.raw) as never);
    for (const [, b] of out.batches) {
      const batch = b as unknown as BatchLike;
      // The relayer frequently does NOT echo stealthPoolNoteIds on a FAILED batch
      // (e.g. NullifierAlreadyBurnt) — fall back to the chunk's own ids so the
      // note is still resolved + recorded instead of silently reappearing forever.
      const ids =
        batch.stealthPoolNoteIds && batch.stealthPoolNoteIds.length > 0
          ? batch.stealthPoolNoteIds
          : chunk.map((c) => c.id);
      if (isBatchSuccessful(batch)) {
        for (const id of ids) results.push(successResult(batch, id));
        continue;
      }
      if (batch.failureReason?.includes("NullifierAlreadyBurnt")) {
        // Already burnt on-chain → idempotent SUCCESS (record it so the UI hides
        // it on the next scan). With BURN_BATCH_SIZE=1 the chunk is one note; if
        // a larger batch reverted on one stale nullifier, retry each individually
        // so the fresh notes in it still claim.
        if (chunk.length === 1) {
          results.push({ noteId: chunk[0]!.id, success: true, signature: "", status: batch.status, error: "Note already burnt" });
        } else {
          for (const n of chunk) results.push(await burnSingle(client, n));
        }
        continue;
      }
      const err = batchError(batch);
      for (const id of ids) results.push({ noteId: id, success: false, signature: "", status: batch.status, error: err });
    }
    if (results.length === 0) {
      for (const n of chunk) results.push({ noteId: n.id, success: false, signature: "", error: "No batch result returned" });
    }
  } catch (e) {
    const msg = formatSdkErrorString(e);
    const burnt = /NullifierAlreadyBurnt/.test(msg);
    for (const n of chunk) {
      results.push({ noteId: n.id, success: burnt, signature: "", error: burnt ? "Note already burnt" : msg });
    }
  }
  return results;
}

async function burnSelfOne(
  client: IUmbraClient,
  note: BurnableNote,
): Promise<BurnResult> {
  if (!client.fetchBatchMerkleProof) {
    return {
      noteId: note.id,
      success: false,
      signature: "",
      error: "client.fetchBatchMerkleProof unavailable",
    };
  }
  const r = relayer();
  const burn = getSelfBurnableStealthPoolNoteIntoATABurnerFunction(
    { client },
    {
      fetchBatchMerkleProof: client.fetchBatchMerkleProof,
      zkProver: burnSelfIntoPublicProver,
      relayer: {
        submitBurn:        r.submitClaim,
        pollBurnStatus:    r.pollClaimStatus,
        getRelayerAddress: r.getRelayerAddress,
      },
    },
  );
  try {
    const out = await burn([note.raw] as never);
    const batch = out.batches.values().next().value as BatchLike | undefined;
    if (batch && isBatchSuccessful(batch)) {
      return successResult(batch, note.id);
    }
    if (batch?.failureReason?.includes("NullifierAlreadyBurnt")) {
      return { noteId: note.id, success: true, signature: "", error: "Note already burnt" };
    }
    return {
      noteId: note.id,
      success: false,
      signature: "",
      error: batch ? batchError(batch) : "No batch result returned",
    };
  } catch (e) {
    return { noteId: note.id, success: false, signature: "", error: formatSdkErrorString(e) };
  }
}

export async function burnSingle(client: IUmbraClient, note: BurnableNote): Promise<BurnResult> {
  return note.type === "receiver"
    ? (await burnReceiverChunk(client, [note]))[0]!
    : await burnSelfOne(client, note);
}

export async function burnBatch(
  client: IUmbraClient,
  notes: readonly BurnableNote[],
): Promise<BurnResult[]> {
  if (notes.length === 0) return [];
  const { receiver, self } = groupByType(notes);

  const receiverResults: BurnResult[] = [];
  for (let i = 0; i < receiver.length; i += BURN_BATCH_SIZE) {
    const chunk = receiver.slice(i, i + BURN_BATCH_SIZE);
    receiverResults.push(...(await burnReceiverChunk(client, chunk)));
  }

  const selfResults: BurnResult[] = [];
  for (const n of self) {
    selfResults.push(await burnSelfOne(client, n));
  }

  return [...receiverResults, ...selfResults];
}
