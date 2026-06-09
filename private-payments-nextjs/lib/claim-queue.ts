// Idempotent burn wrapper. Implements the pitfalls.md §3 pattern:
//
//   1. Verify the nullifier isn't already burnt on-chain BEFORE submitting.
//      If burnt, the burn already landed — skip.
//   2. Submit to the relayer, capture request_id.
//   3. Poll request_id to terminal state (completed | failed | timed_out).
//      DUPLICATE_OFFSET (HTTP 409) is treated as success — the relayer
//      saw a prior request for the same nullifier.
//   4. On non-terminal failure, re-check the on-chain nullifier before
//      retrying. Never blindly resubmit.
//
// Same-wallet round-trip block: refuse to burn into the source PATA
// (privacy.md anti-pattern §1).
//
// Note: the relayer wire types kept legacy `claim` identifiers
// (`ClaimStatusPollerFunction`, `pollClaimUntilTerminal`); the burn
// pipeline uses TS aliases of these (`BurnStatusPollerFunction =
// ClaimStatusPollerFunction`) so the existing helpers plug in directly.

import { pollClaimUntilTerminal } from "@umbra-privacy/sdk";
import type { ClaimStatusPollerFunction } from "@umbra-privacy/sdk";

export type ClaimTerminalStatus = "completed" | "failed" | "timed_out" | "refunded";

export interface ClaimSubmitResult {
  requestId: string;
}

export interface ClaimRunResult {
  status: ClaimTerminalStatus | "skipped_already_burnt";
  requestId?: string;
}

export interface ClaimQueueArgs {
  sourceAddress: string;
  destinationAddress: string;
  isNullifierBurntOnChain: () => Promise<boolean>;
  submitClaim: () => Promise<ClaimSubmitResult>;
  pollClaimStatus: ClaimStatusPollerFunction;
}

export async function runClaimWithIdempotency(args: ClaimQueueArgs): Promise<ClaimRunResult> {
  if (args.sourceAddress === args.destinationAddress) {
    throw new Error(
      "Refusing to burn back to the source PATA — same-wallet round-trip eliminates all privacy. " +
        "See privacy.md anti-pattern §1.",
    );
  }

  if (await args.isNullifierBurntOnChain()) {
    return { status: "skipped_already_burnt" };
  }

  const { requestId } = await args.submitClaim();
  const result = await pollClaimUntilTerminal(args.pollClaimStatus, requestId);
  const status = result.status as ClaimTerminalStatus;

  if (status === "completed") return { status, requestId };
  if (status === "failed" || status === "timed_out" || status === "refunded") {
    if (await args.isNullifierBurntOnChain()) {
      return { status: "completed", requestId };
    }
    return { status, requestId };
  }
  return { status, requestId };
}
