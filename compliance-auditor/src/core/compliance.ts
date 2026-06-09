// Framework-agnostic Umbra compliance core — SELECTIVE DISCLOSURE.
//
// PURE: no Node APIs, no console, no filesystem. Every function takes an
// `IUmbraClient` (built however the host wants — see client.ts) and returns
// plain data. Drop these straight into a CLI, a React hook, an Android bridge,
// a server route — nothing here assumes a runtime.
//
// Umbra exposes TWO independent disclosure mechanisms; this module covers both:
//
//   1. VIEWING KEYS (off-chain, read-only, no transaction)
//      A Poseidon-keyed hierarchy: Master → Mint → Yearly → Monthly → Daily.
//      Each level is a *scoped* read credential the subject can hand to an
//      auditor. Master decrypts everything; Daily decrypts a single mint on a
//      single day. The subject derives them from its master seed (`deriveScopedViewingKeys`)
//      and hands the chosen scope to the auditor out-of-band.
//
//   2. X25519 RE-ENCRYPTION GRANT (on-chain, MPC, revocable)
//      The subject authorises a *specific registered auditor* to have the
//      network re-encrypt the subject's EncryptedTokenAccount ciphertexts to the
//      auditor's key. Issue → query → revoke (`issueComplianceGrant` etc.).

import type { IUmbraClient } from "@umbra-privacy/sdk";
import type { Address } from "@solana/kit";
import {
  getComplianceGrantIssuerFunction,
  getComplianceGrantRevokerFunction,
  getUserComplianceGrantQuerierFunction,
} from "@umbra-privacy/sdk/compliance";
import {
  getMasterViewingKeyDeriver,
  getMintViewingKeyDeriver,
  getMonthlyViewingKeyDeriver,
  getDailyViewingKeyDeriver,
  getMasterViewingKeyX25519KeypairDeriver,
} from "@umbra-privacy/sdk/crypto";
import { getUserAccountQuerierFunction } from "@umbra-privacy/sdk/query";
import { generateRandomNonce } from "@umbra-privacy/sdk/arcium";
import type {
  Year,
  Month,
  Day,
  RescueCipherEncryptionNonce,
  X25519PublicKey,
} from "@umbra-privacy/sdk/types";

const hex = (k: bigint): string => "0x" + k.toString(16).padStart(64, "0");

/* ============================================================================
 * 1. VIEWING KEYS — scoped read credentials (no transaction)
 * ========================================================================== */

export interface ScopedDate {
  /** Full year, e.g. 2026. */
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
}

export interface ScopedViewingKeys {
  /** Sees ALL of the subject's activity, all mints, all time. The broadest credential. */
  master: string;
  /** Scoped to one mint. */
  mint: string;
  /** Scoped to one mint + month. */
  monthly: string;
  /** Scoped to one mint + day — the narrowest disclosure. */
  daily: string;
}

/**
 * Derive the viewing-key hierarchy for `mint` on `date`. The subject runs this
 * against its own client (its master seed); it hands the chosen scope to the
 * auditor. Read-only — no on-chain transaction.
 */
export async function deriveScopedViewingKeys(
  client: IUmbraClient,
  mint: Address,
  date: ScopedDate,
): Promise<ScopedViewingKeys> {
  const y = BigInt(date.year) as Year;
  const m = BigInt(date.month) as Month;
  const d = BigInt(date.day) as Day;

  const master = await getMasterViewingKeyDeriver({ client })();
  const mintKey = await getMintViewingKeyDeriver({ client })(mint);
  const monthly = await getMonthlyViewingKeyDeriver({ client })(mint, y, m);
  const daily = await getDailyViewingKeyDeriver({ client })(mint, y, m, d);

  return {
    master: hex(master as unknown as bigint),
    mint: hex(mintKey as unknown as bigint),
    monthly: hex(monthly as unknown as bigint),
    daily: hex(daily as unknown as bigint),
  };
}

/* ============================================================================
 * 2. X25519 RE-ENCRYPTION GRANT — on-chain, revocable, per-auditor
 * ========================================================================== */

/**
 * Everything needed to query or revoke a grant later. Persist this on the
 * subject's side after issuing (the `nonce` in particular is not recoverable).
 */
export interface ComplianceGrant {
  auditorAddress: Address;
  granterX25519PublicKey: X25519PublicKey;
  granteeX25519PublicKey: X25519PublicKey;
  nonce: RescueCipherEncryptionNonce;
}

export interface IssuedGrant extends ComplianceGrant {
  signature: string;
}

/**
 * Subject authorises `auditorAddress` to receive re-encryptions of the subject's
 * ciphertexts. The auditor MUST already be registered on Umbra (have an X25519
 * key) — we pre-check and throw a clear error otherwise. MPC transaction.
 */
export async function issueComplianceGrant(
  client: IUmbraClient,
  auditorAddress: Address,
): Promise<IssuedGrant> {
  const granterKp = await getMasterViewingKeyX25519KeypairDeriver({ client })();
  const acct = await getUserAccountQuerierFunction({ client })(auditorAddress);
  if (acct.state !== "exists" || !acct.data.isUserAccountX25519KeyRegistered) {
    throw new Error(
      `auditor ${auditorAddress} has no registered Umbra X25519 key — they must register on Umbra before a grant can target them`,
    );
  }
  const granterX = granterKp.x25519Keypair.publicKey;
  const granteeX = acct.data.x25519PublicKey;
  const nonce = generateRandomNonce();

  const issue = getComplianceGrantIssuerFunction({ client });
  const signature = String(await issue(auditorAddress, granterX, granteeX, nonce));

  return {
    auditorAddress,
    granterX25519PublicKey: granterX,
    granteeX25519PublicKey: granteeX,
    nonce: nonce as RescueCipherEncryptionNonce,
    signature,
  };
}

/** Read the on-chain state of a previously-issued grant (e.g. `"active"`). */
export async function queryComplianceGrant(
  client: IUmbraClient,
  grant: ComplianceGrant,
): Promise<{ state: string }> {
  const query = getUserComplianceGrantQuerierFunction({ client });
  const r = await query(grant.granterX25519PublicKey, grant.nonce, grant.granteeX25519PublicKey);
  return { state: String(r.state) };
}

/** Revoke the grant — the auditor can no longer obtain re-encryptions. MPC transaction. */
export async function revokeComplianceGrant(
  client: IUmbraClient,
  grant: ComplianceGrant,
): Promise<string> {
  const revoke = getComplianceGrantRevokerFunction({ client });
  return String(
    await revoke(
      grant.auditorAddress,
      grant.granterX25519PublicKey,
      grant.granteeX25519PublicKey,
      grant.nonce,
    ),
  );
}
