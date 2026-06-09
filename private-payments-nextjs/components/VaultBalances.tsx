"use client";

// Vault dashboard — shows your shielded EncryptedTokenAccount (ETA) balance for
// every supported mint, plus native SOL. Uses getEncryptedBalanceQuerierFunction
// (client-side decryption; "shared" → readable amount, "mxe" → network-only,
// "uninitialized"/"non_existent" → no balance yet). Auto-loads on mount, polls
// every 20s, and offers a manual refresh.

import { useCallback, useEffect, useState } from "react";
import { getEncryptedBalanceQuerierFunction } from "@umbra-privacy/sdk/query";
import { useUmbraSession } from "@/app/providers";
import { env } from "@/lib/env";
import { SUPPORTED_MINTS } from "@/lib/supported-mints";

const MINTS = SUPPORTED_MINTS.filter((m) => m.network === env.NEXT_PUBLIC_NETWORK);

interface Row {
  symbol: string;
  mint: string;
  decimals: number;
  state: "shared" | "mxe" | "uninitialized" | "non_existent" | "error";
  amount?: string; // shielded (ETA) human amount, when shared
  publicAmount?: string; // public (ATA) human amount
}

function fmt(base: bigint, decimals: number): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const d = BigInt(10) ** BigInt(decimals);
  const whole = v / d;
  const frac = (v % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

async function getSol(addr: string): Promise<number | null> {
  try {
    const r = await fetch(env.NEXT_PUBLIC_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] }),
    });
    const j = await r.json();
    return (j?.result?.value ?? 0) / 1e9;
  } catch {
    return null;
  }
}

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// Fetch ALL the owner's SPL token balances in ONE RPC call (by token program,
// not one-per-mint) → Map<mint, uiAmount>. Public devnet RPC rate-limits, so we
// must minimise calls: this replaces N per-mint getTokenAccountsByOwner calls.
async function getAllPublicBalances(owner: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const r = await fetch(env.NEXT_PUBLIC_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [owner, { programId: SPL_TOKEN_PROGRAM }, { encoding: "jsonParsed", commitment: "confirmed" }],
      }),
    });
    const j = await r.json();
    const accts: unknown[] = j?.result?.value ?? [];
    for (const a of accts) {
      const info = (a as { account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } })
        .account?.data?.parsed?.info;
      if (info?.mint && typeof info.tokenAmount?.uiAmount === "number") {
        out.set(info.mint, (out.get(info.mint) ?? 0) + info.tokenAmount.uiAmount);
      }
    }
  } catch {
    /* leave empty on error/rate-limit */
  }
  return out;
}

export function VaultBalances() {
  const { client, selectedAccount } = useUmbraSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !selectedAccount) return;
    setLoading(true);
    setError(null);
    try {
      const query = getEncryptedBalanceQuerierFunction({ client });
      const map = await query(MINTS.map((m) => m.mint as never));
      const publicMap = await getAllPublicBalances(selectedAccount.address); // ONE rpc call
      const next: Row[] = MINTS.map((m) => {
        const pub = publicMap.get(m.mint);
        const publicAmount = pub !== undefined ? String(pub) : undefined;
        const r = map.get(m.mint as never) as
          | { state: "shared"; balance: bigint }
          | { state: "mxe" | "uninitialized" | "non_existent" }
          | undefined;
        if (!r) return { ...m, state: "non_existent" as const, publicAmount };
        if (r.state === "shared") {
          return { ...m, state: "shared" as const, amount: fmt(BigInt(r.balance), m.decimals), publicAmount };
        }
        return { ...m, state: r.state, publicAmount };
      });
      setRows(next);
      setSol(await getSol(selectedAccount.address));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client, selectedAccount]);

  useEffect(() => {
    void refresh();
    // Poll at 60s and ONLY when the tab is visible — public devnet RPC
    // rate-limits aggressively. Use the manual ↻ Refresh for an immediate read.
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void refresh();
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!client || !selectedAccount) return null;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Vault balances</h2>
        <button className="secondary" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Shielded balances in your EncryptedTokenAccount (per mint). Auto-refreshes every 20s.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th>Token</th>
            <th>Shielded (ETA)</th>
            <th>Public (ATA)</th>
            <th className="muted">Mint</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? MINTS.map((m) => ({ ...m, state: "non_existent" as const }))).map((r) => (
            <tr key={r.mint}>
              <td><strong>{r.symbol}</strong></td>
              <td className="mono">
                {r.state === "shared"
                  ? `${r.amount} ${r.symbol}`
                  : r.state === "mxe"
                    ? "encrypted (network-only)"
                    : r.state === "error"
                      ? "—"
                      : "0"}
              </td>
              <td className="mono">
                {"publicAmount" in r && r.publicAmount !== undefined ? `${r.publicAmount} ${r.symbol}` : "…"}
              </td>
              <td className="muted mono" style={{ fontSize: "0.8em" }}>
                {r.mint.slice(0, 4)}…{r.mint.slice(-4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 8 }}>
        Native SOL: <span className="mono">{sol === null ? "…" : sol.toFixed(4)}</span>
        {sol !== null && sol < 0.05 && (
          <span className="error"> — low; MPC ops (create/withdraw) need rent for proof + Arcium accounts.</span>
        )}
      </p>
      {error && <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>}
    </div>
  );
}
