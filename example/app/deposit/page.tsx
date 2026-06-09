"use client";

// Shield funds — move tokens from your PUBLIC balance (an ATA you own) INTO
// your EncryptedTokenAccount (ETA). This is how you fund the shielded side.
//
//   ATA → ETA  via getATAIntoETADirectDepositorFunction (MPC; no ZK proof, no
//   relayer). The Arcium network credits your encrypted balance in a callback.
//
// Privacy: the deposit itself is Tier-2 (public source, shielded destination —
// the amount entering is observable). Once funds are in your ETA you can move
// them privately (Tier 1) via Transfer, or create mixer notes via Send.
//
// Critical rules: 1 (no generationIndex), 9 (mint/pool check), 14 N/A (self).

import { useState } from "react";
import { getATAIntoETADirectDepositorFunction } from "@umbra-privacy/sdk/deposit";
import { Nav } from "@/components/Nav";
import { WalletButton } from "@/components/WalletButton";
import { RegistrationGate } from "@/components/RegistrationGate";
import { PrivacyTierBadge } from "@/components/PrivacyTierBadge";
import { DebugPanel } from "@/components/DebugPanel";
import { useUmbraSession } from "@/app/providers";
import { env } from "@/lib/env";
import { isSupportedMint, findMint } from "@/lib/supported-mints";
import { parseAmount } from "@/lib/amount";
import { formatSdkErrorString } from "@/lib/format-error";
import { dbg } from "@/lib/umbra-debug";

export default function ShieldPage() {
  const { client, selectedAccount } = useUmbraSession();
  const [amount, setAmount] = useState("");
  const [mint, setMint] = useState(env.NEXT_PUBLIC_DEFAULT_MINT);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<readonly { label: string; sig: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const network = env.NEXT_PUBLIC_NETWORK as "mainnet-beta" | "devnet";

  async function shield() {
    if (!client || !selectedAccount) return;
    setError(null);
    setSignatures(null);
    setStep(null);

    if (!isSupportedMint(mint, network)) {
      setError(`Mint ${mint} is not on the Umbra supported-tokens list for ${network}.`);
      return;
    }
    const meta = findMint(mint, network);
    if (!meta) return;

    let amountRaw: bigint;
    try {
      amountRaw = parseAmount(amount, meta.decimals);
    } catch {
      setError("Invalid amount.");
      return;
    }
    if (amountRaw <= 0n) {
      setError("Amount must be positive.");
      return;
    }

    setSubmitting(true);
    try {
      dbg("shield", `ATA→ETA ${meta.symbol} ${amount} (raw ${amountRaw.toString()}) on ${network}`, {
        mint,
        amountRaw: amountRaw.toString(),
      });
      setStep("Shielding into your encrypted balance (MPC, ~10–30s)…");

      const deposit = getATAIntoETADirectDepositorFunction({ client });
      const result = await deposit(
        selectedAccount.address as never,
        mint as never,
        amountRaw as never,
      );

      // DepositResult { queueSignature, callback?, rentClaim?, signatures }.
      const out: { label: string; sig: string }[] = [
        { label: "deposit (queue)", sig: String(result.queueSignature) },
      ];
      if (result.callback?.status === "finalized" && result.callback.signature) {
        out.push({ label: "callback", sig: String(result.callback.signature) });
      }
      setSignatures(out);
      setStep(null);
      dbg("shield", "shield done", result);
    } catch (e: unknown) {
      const msg = formatSdkErrorString(e);
      console.error("Umbra shield failed:", msg);
      dbg("shield", "shield FAILED", e);
      setError(msg);
      setStep(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Nav active="deposit" />
      <h1>Shield funds <PrivacyTierBadge tier={2} /></h1>
      <p className="muted">
        Move tokens from your <strong>public balance</strong> into your{" "}
        <strong>encrypted balance</strong> (EncryptedTokenAccount). The amount entering is
        public, but once shielded you can move it privately on the Transfer tab or create
        mixer notes on Send.
      </p>
      <WalletButton />
      <RegistrationGate>
        <div className="card">
          <label>Amount</label>
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            inputMode="decimal"
            placeholder="0.00"
          />
          <label>Mint</label>
          <input value={mint} onChange={(e) => setMint(e.target.value)} spellCheck={false} />
          <p className="muted">
            {findMint(mint, network)?.symbol ?? "(unsupported)"} · from your{" "}
            {selectedAccount ? `${selectedAccount.address.slice(0, 4)}…${selectedAccount.address.slice(-4)}` : "wallet"} ATA
          </p>
          <button onClick={() => void shield()} disabled={submitting || !amount}>
            {submitting ? "Shielding…" : "Shield into encrypted balance"}
          </button>
          {step && <p className="muted">{step}</p>}
          {error && <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>}
          {signatures && (
            <>
              <h2>Shielded</h2>
              <p className="muted">
                Funds are now in your EncryptedTokenAccount. Head to Transfer to move them
                privately, or Send to create a mixer note.
              </p>
              {signatures.map((s) => (
                <p key={s.sig} className="mono">{s.label}: {s.sig}</p>
              ))}
            </>
          )}
        </div>
        <DebugPanel />
      </RegistrationGate>
    </>
  );
}
