/**
 * WORKAROUND for a confirmed bug in @umbra-privacy/sdk@5.0.0-rc.4.
 *
 * The columnar UTXO-fetch path (used by every scan()) base64-encodes the
 * `h1_version` / `h1_commitment_index` byte fields, then the consumer calls
 * `BigInt(item.h1_version)` on the base64 STRING — which throws
 *   "Cannot convert AQAAAAAAAAAAAAAAAAAAAA== to a BigInt".
 * The row-oriented path handles these correctly via readU128LeFromBytes; only
 * the columnar path is broken, so all scans (the Claim tab) fail on devnet.
 *
 * Fix: replace each `BigInt(item.h1_*)` with an inline IIFE that decodes the
 * base64 little-endian bytes (and still accepts a plain numeric value). An IIFE
 * is a valid object-property VALUE, so nothing is inserted as a statement —
 * this is webpack/swc-safe (an earlier version that injected a `const` inside
 * the object literal broke `next build`).
 *
 * Idempotent + self-healing: re-running is a no-op, and it repairs the earlier
 * broken-`const` form if present. Wired as a postinstall + `pnpm fix-sdk`.
 * Remove once the SDK ships a fix.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
let distDir;
try {
  distDir = join(dirname(require.resolve("@umbra-privacy/sdk/package.json")), "dist");
} catch {
  console.log("(@umbra-privacy/sdk not installed yet — skipping patch)");
  process.exit(0);
}

const iife = (field) =>
  `(() => { try { return BigInt(item.${field}); } catch { const u = Buffer.from(String(item.${field}), "base64"); let n = 0n; for (let i = u.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(u[i]); return n; } })()`;

const MARKER = "try { return BigInt(item.h1_version); } catch"; // present iff already inline-patched

// Exact broken block injected by the earlier (flawed) patch — reverted to pristine.
const BROKEN =
  'const __b64le = (v) => { try { return BigInt(v); } catch { const u = Buffer.from(String(v), "base64"); let n = 0n; for (let i = u.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(u[i]); return n; } };\n        version: __b64le(item.h1_version),\n          commitmentIndex: __b64le(item.h1_commitment_index),';
const PRISTINE =
  "version: BigInt(item.h1_version),\n          commitmentIndex: BigInt(item.h1_commitment_index),";
const INLINE = `version: ${iife("h1_version")},\n          commitmentIndex: ${iife("h1_commitment_index")},`;

let patched = 0;
let alreadyOk = 0;
let repaired = 0;
for (const file of readdirSync(distDir).filter((f) => f.endsWith(".js") || f.endsWith(".cjs"))) {
  const path = join(distDir, file);
  let src = readFileSync(path, "utf8");
  if (src.includes(MARKER)) { alreadyOk++; continue; }

  let changed = false;
  if (src.includes(BROKEN)) { src = src.replace(BROKEN, PRISTINE); changed = true; repaired++; }
  if (src.includes(PRISTINE)) { src = src.replace(PRISTINE, INLINE); changed = true; }

  if (changed) {
    writeFileSync(path, src);
    console.log(`patched: dist/${file}`);
    patched++;
  }
}

if (patched > 0) console.log(`\n✓ rc.4 columnar-scan workaround applied to ${patched} file(s)${repaired ? ` (repaired ${repaired} broken-const file(s))` : ""}.`);
else if (alreadyOk > 0) console.log("✓ already patched — nothing to do.");
else console.log("⚠ target lines not found — SDK version may have changed; inspect dist/ manually.");
