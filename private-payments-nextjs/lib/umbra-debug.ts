"use client";

// Umbra debug instrumentation.
//
// One place to answer "why didn't this transaction land / why can't the
// recipient see it?" without re-running on-chain forensics by hand. Every
// failure this scaffold hit in practice is observable here:
//
//   - KeyConsistencyError / silent discovery failure
//       → dumpKeyConsistency() reports, per key, whether the LOCALLY-derived
//         key matches the ON-CHAIN registered key. A receiver-claimable note
//         is found only if the recipient's token-encryption OR MVK X25519 key
//         is consistent (the scanner tries both — see burn/scanner.ts). If
//         either shows `consistent: false`, that is the discovery failure.
//   - "recipient never received"
//       → on send we log the recipient's on-chain X25519 key the note is
//         encrypted to, plus the chosen variant. On scan we log per-bucket
//         note counts + tree progress, so "0 received" is distinguishable
//         from "scanner never ran" / "indexer empty".
//   - fee_vault 3003 / wrong-mint / unsupported token
//       → send logs the resolved mint + amountRaw + every step signature.
//
// Logging is ON by default (this is a dev/test scaffold). Silence it with
// NEXT_PUBLIC_UMBRA_DEBUG=0. Output goes to the browser console AND a small
// in-memory ring buffer that <DebugPanel/> renders + copies to clipboard —
// handy when testing on a phone / when the console isn't open.

import { verifyKeyConsistency } from "@umbra-privacy/sdk/validation";
import { getUserAccountQuerierFunction } from "@umbra-privacy/sdk/query";
import type { IUmbraClient } from "@umbra-privacy/sdk";
import { SUPPORTED_MINTS } from "./supported-mints";
import { env } from "./env";

// The SDK's default key-consistency mint list omits dUSDC/dUSDT on devnet
// (only wSOL). Include the app's mints so the consistency dump reflects the
// tokens you actually use. See RegistrationGate's APP_MINTS for the why.
const APP_MINTS = SUPPORTED_MINTS.filter(
  (m) => m.network === env.NEXT_PUBLIC_NETWORK,
).map((m) => m.mint as never);

export const DEBUG_ON =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_UMBRA_DEBUG === "0"
    ? false
    : true;

export interface DebugEvent {
  readonly t: number; // epoch ms
  readonly scope: string; // "send" | "scan" | "keys" | "account" | …
  readonly msg: string;
  readonly data?: unknown;
}

const RING_MAX = 300;
const ring: DebugEvent[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to ring-buffer changes (for the on-screen panel). */
export function subscribeDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Snapshot of the current ring buffer, oldest → newest. */
export function getDebugEvents(): readonly DebugEvent[] {
  return ring;
}

export function clearDebugEvents(): void {
  ring.length = 0;
  notify();
}

/**
 * JSON.stringify that survives the value types Umbra surfaces: bigint,
 * Uint8Array (rendered as a short fingerprint), Error.
 */
export function safeStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v: unknown) => {
      if (typeof v === "bigint") return `${v.toString()}n`;
      if (v instanceof Uint8Array) return keyFp(v);
      if (v instanceof Error) return `${v.name}: ${v.message}`;
      return v;
    },
    2,
  );
}

/**
 * Short, eyeball-comparable fingerprint of a byte key: first 8 bytes + length.
 * e.g. `[114,80,196,77,59,174,82,43…] (32B)` — paste-compare against an
 * on-chain key without dumping all 32 bytes.
 */
export function keyFp(bytes: Uint8Array | null | undefined): string {
  if (!bytes) return "(none)";
  const head = Array.from(bytes.slice(0, 8)).join(",");
  return `[${head}${bytes.length > 8 ? "…" : ""}] (${bytes.length}B)`;
}

/** Core logger. No-op when DEBUG_ON is false. */
export function dbg(scope: string, msg: string, data?: unknown): void {
  if (!DEBUG_ON) return;
  const evt: DebugEvent = { t: Date.now(), scope, msg, data };
  ring.push(evt);
  if (ring.length > RING_MAX) ring.shift();
  notify();
  // eslint-disable-next-line no-console
  console.info(
    `%c[umbra:${scope}]%c ${msg}`,
    "color:#7c5cff;font-weight:600",
    "color:inherit",
    data === undefined ? "" : data,
  );
}

export interface KeyConsistencySummary {
  readonly allConsistent: boolean;
  readonly mismatches: readonly string[]; // field names that don't match
  readonly results: readonly { field: string; consistent: boolean; detail: string }[];
}

/**
 * THE discovery diagnostic. Reports whether this wallet's locally-derived keys
 * match what's registered on-chain. If `allConsistent` is false, any
 * receiver-claimable note encrypted to a mismatched key is undiscoverable —
 * run "Restore key consistency" on the Account page, then re-scan.
 *
 * Checks: token-encryption X25519 key, MVK X25519 key, the user commitment,
 * and per-mint token-account keys.
 */
export async function dumpKeyConsistency(
  client: IUmbraClient,
  label = "self",
): Promise<KeyConsistencySummary | null> {
  if (!DEBUG_ON) return null;
  try {
    const res = await verifyKeyConsistency({
      client,
      includeUserCommitment: true,
      additionalMints: APP_MINTS,
    });
    const summary: KeyConsistencySummary = {
      allConsistent: res.allConsistent,
      mismatches: res.mismatches.map((m) => m.field),
      results: res.results.map((r) => ({
        field: r.field,
        consistent: r.consistent,
        detail: r.detail,
      })),
    };
    dbg(
      "keys",
      `${label}: ${summary.allConsistent ? "✓ all keys consistent" : `✗ MISMATCH on ${summary.mismatches.join(", ")}`}`,
      summary.results,
    );
    return summary;
  } catch (e) {
    dbg("keys", `${label}: key-consistency check threw`, e);
    return null;
  }
}

export interface AccountSnapshot {
  readonly exists: boolean;
  readonly isInitialised: boolean;
  readonly hasX25519: boolean;
  readonly hasCommitment: boolean;
  readonly x25519Fp: string; // fingerprint of the on-chain MVK X25519 key
}

/**
 * Logs an on-chain user account: registration flags + the MVK X25519 key the
 * account publishes (one of the two keys a depositor can encrypt a
 * receiver-claimable note to). Use it on the recipient at send time and on the
 * connected wallet at scan time, then compare the two fingerprints.
 */
export async function dumpUserAccount(
  client: IUmbraClient,
  address: string,
  label: string,
): Promise<AccountSnapshot | null> {
  if (!DEBUG_ON) return null;
  try {
    const querier = getUserAccountQuerierFunction({ client });
    const result = await querier(address as never);
    if (result.state !== "exists") {
      const snap: AccountSnapshot = {
        exists: false,
        isInitialised: false,
        hasX25519: false,
        hasCommitment: false,
        x25519Fp: "(no account)",
      };
      dbg("account", `${label} ${address.slice(0, 8)}… → NOT registered`, snap);
      return snap;
    }
    const d = (result.data ?? {}) as unknown as Record<string, unknown>;
    const x25519 = d.x25519PublicKey as Uint8Array | undefined;
    const snap: AccountSnapshot = {
      exists: true,
      isInitialised: Boolean(d.isInitialised),
      hasX25519: Boolean(d.isUserAccountX25519KeyRegistered),
      hasCommitment: Boolean(d.isUserCommitmentRegistered),
      x25519Fp: keyFp(x25519),
    };
    dbg("account", `${label} ${address.slice(0, 8)}… MVK-X25519=${snap.x25519Fp}`, snap);
    return snap;
  } catch (e) {
    dbg("account", `${label} ${address.slice(0, 8)}… query threw`, e);
    return null;
  }
}
