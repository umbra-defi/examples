"use client";

// Step 5 — Withdraw (unshield). Move funds OUT of your EncryptedTokenAccount
// back to your PUBLIC balance:
//
//   ETA → ATA  via getETAIntoATAWithdrawerFunction({ client }). MPC, no ZK proof.
//   The on-chain instruction hard-derives the destination as the SIGNER's own
//   ATA (associated_token::authority = user_address), so withdrawals can only
//   go to your own wallet — there is no arbitrary-recipient withdraw on this
//   path. The destination ATA must already exist (it does if you've ever held
//   this token). Confirms via the client's polling transport (no WebSocket).
//
// Critical rules: 9 (mint/pool check).

import { useState } from "react";
import { getETAIntoATAWithdrawerFunction } from "@umbra-privacy/sdk/withdrawal";
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

export default function WithdrawPage() {
  const { client, selectedAccount } = useUmbraSession();
  const [amount, setAmount] = useState("");
  const [mint, setMint] = useState(env.NEXT_PUBLIC_DEFAULT_MINT);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<readonly { label: string; sig: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const network = env.NEXT_PUBLIC_NETWORK as "mainnet-beta" | "devnet";

  async function withdraw() {
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
      const destinationAddress = selectedAccount.address;
      dbg("withdraw", `ETA→ATA ${meta.symbol} raw ${amountRaw.toString()} to self`, {
        destinationAddress,
        mint,
        amountRaw: amountRaw.toString(),
      });
      setStep("Withdrawing to your public balance (MPC, ~10–30s)…");

      const fn = getETAIntoATAWithdrawerFunction({ client });
      const result = await fn(
        destinationAddress as never,
        mint as never,
        amountRaw as never,
      );

      // WithdrawResult { queueSignature, callback?, rentClaim?, signatures }.
      const out: { label: string; sig: string }[] = [
        { label: "withdraw (queue)", sig: String(result.queueSignature) },
      ];
      if (result.callback?.status === "finalized" && result.callback.signature) {
        out.push({ label: "callback", sig: String(result.callback.signature) });
      }
      setSignatures(out);
      setStep(null);
      dbg("withdraw", "withdraw done", result);
    } catch (e: unknown) {
      const msg = formatSdkErrorString(e);
      console.error("Umbra withdraw failed:", msg);
      dbg("withdraw", "withdraw FAILED", e);
      setError(msg);
      setStep(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Nav active="withdraw" />
      <h1>5 · Withdraw <PrivacyTierBadge tier={2} /></h1>
      <p className="muted">
        Unshield from your <strong>encrypted balance</strong> back to your{" "}
        <strong>own public balance</strong> (your wallet&apos;s ATA for this mint). The ATA must
        already exist. Withdrawals can only go to yourself.
      </p>
      <WalletButton />
      <RegistrationGate>
        <div className="card">
          <p className="muted">
            Destination: your wallet{" "}
            {selectedAccount
              ? `(${selectedAccount.address.slice(0, 4)}…${selectedAccount.address.slice(-4)})`
              : ""}
          </p>
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
          <p className="muted">{findMint(mint, network)?.symbol ?? "(unsupported)"}</p>

          <button onClick={() => void withdraw()} disabled={submitting || !amount}>
            {submitting ? "Withdrawing…" : "Withdraw to public balance"}
          </button>

          {step && <p className="muted">{step}</p>}
          {error && <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>}
          {signatures && (
            <>
              <h2>Withdrawn (ETA → public ATA)</h2>
              <p className="muted">
                Protocol fees (if any) are deducted by the MPC callback, so the ATA receives
                slightly less than requested on fee-bearing mints.
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
