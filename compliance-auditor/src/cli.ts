// Node CLI adapter + demo for the compliance core.
//
// This file is the ONLY Node-specific layer: it reads keypair files + env and
// prints to the console. Everything it calls (`src/core/*`) is pure and runs
// unchanged in a browser or mobile app — see README "Porting".
//
//   SUBJECT (the audited user) derives scoped viewing keys, then issues an
//   on-chain X25519 re-encryption grant to the AUDITOR, queries it, and revokes it.
//
// Run:  pnpm demo

import { readFileSync } from "node:fs";
import { address, type Address } from "@solana/kit";
import { createSignerFromPrivateKeyBytes, type IUmbraSigner } from "@umbra-privacy/sdk";

import { buildUmbraClient, type UmbraEndpoints } from "./core/client.js";
import {
  deriveScopedViewingKeys,
  issueComplianceGrant,
  queryComplianceGrant,
  revokeComplianceGrant,
} from "./core/compliance.js";

// ---------- env ----------
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const INDEXER_API_ENDPOINT =
  process.env.INDEXER_API_ENDPOINT ?? "https://utxo-indexer.api-devnet.umbraprivacy.com";
const MINT = address(process.env.MINT ?? "4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7");
const SUBJECT_KEYPAIR = process.env.SUBJECT_KEYPAIR ?? ".keys/subject.json";
const AUDITOR_KEYPAIR = process.env.AUDITOR_KEYPAIR ?? ".keys/auditor.json";

const endpoints: UmbraEndpoints = { rpcUrl: RPC_URL, indexerApiEndpoint: INDEXER_API_ENDPOINT };

// ---------- tiny console helpers ----------
const ts = () => new Date().toISOString().slice(11, 23);
const log = {
  h: (t: string) => console.log(`\n\x1b[1m\x1b[36m━━━ ${t} ━━━\x1b[0m`),
  ok: (m: string) => console.log(`\x1b[2m${ts()}\x1b[0m  \x1b[32m✓\x1b[0m ${m}`),
  info: (m: string) => console.log(`\x1b[2m${ts()}    ${m}\x1b[0m`),
  fail: (m: string) => console.log(`\x1b[2m${ts()}\x1b[0m  \x1b[31m✗\x1b[0m ${m}`),
};

// Node-only: load a Solana CLI keypair JSON (64-byte secret) as an Umbra signer.
async function loadSigner(path: string): Promise<IUmbraSigner> {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
  if (secret.length !== 64) {
    throw new Error(`${path}: expected a 64-byte secret key array, got ${secret.length}`);
  }
  return createSignerFromPrivateKeyBytes(secret);
}

async function main(): Promise<void> {
  log.h("Umbra compliance auditor (DEVNET) — selective disclosure");

  const subjectSigner = await loadSigner(SUBJECT_KEYPAIR);
  const auditorSigner = await loadSigner(AUDITOR_KEYPAIR); // only need its address
  const auditorAddress = address(auditorSigner.address) as Address;
  log.info(`subject (audited): ${subjectSigner.address}`);
  log.info(`auditor (grantee): ${auditorSigner.address}`);
  log.info(`mint scope:        ${MINT}`);

  const client = await buildUmbraClient({
    signer: subjectSigner,
    network: "devnet",
    endpoints,
  });

  // 1) Viewing keys — scoped, read-only credentials (no transaction). The subject
  //    hands the chosen scope to the auditor out-of-band.
  log.h("1. Derive scoped viewing keys (read-only credentials)");
  const now = new Date();
  const keys = await deriveScopedViewingKeys(client, MINT, {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  });
  log.ok(`master  (all mints, all time): ${keys.master.slice(0, 22)}…`);
  log.ok(`mint    (this mint, all time): ${keys.mint.slice(0, 22)}…`);
  log.ok(`monthly (this mint, month):    ${keys.monthly.slice(0, 22)}…`);
  log.ok(`daily   (this mint, today):    ${keys.daily.slice(0, 22)}…`);
  log.info("Hand the NARROWEST scope that satisfies the auditor's mandate (daily ≪ master).");

  // 2) X25519 re-encryption grant — on-chain, revocable, targets ONE auditor.
  log.h("2. Issue → query → revoke an X25519 re-encryption grant");
  let issued;
  try {
    issued = await issueComplianceGrant(client, auditorAddress);
    log.ok(`grant issued (MPC) — nonce ${String(issued.nonce).slice(0, 14)}… sig ${issued.signature.slice(0, 16)}…`);
  } catch (e) {
    log.fail(`could not issue grant: ${(e as Error).message}`);
    log.info("The auditor must be registered on Umbra (have an X25519 key) before a grant can target them.");
    return;
  }

  const status = await queryComplianceGrant(client, issued);
  log.ok(`grant state on-chain: ${status.state}`);

  const revokeSig = await revokeComplianceGrant(client, issued);
  log.ok(`grant revoked — sig ${revokeSig.slice(0, 16)}…`);

  log.h("done — selective disclosure lifecycle complete");
}

main().catch((e) => {
  log.fail(`fatal: ${(e as Error).stack ?? String(e)}`);
  process.exitCode = 1;
});
