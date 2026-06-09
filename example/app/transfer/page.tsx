"use client";

// Step 3 — Transfer via Stealth Pool Note, FROM your existing encrypted balance
// (fund it first on the Deposit tab). Two explicit modes:
//
//   • Receiver-claimable  ETA → (note) → recipient's ETA
//       getETAIntoReceiverBurnableStealthPoolNoteCreatorFunction. The recipient
//       scans + burns it into their EncryptedTokenAccount on the Claim tab. The
//       recipient MUST be fully registered on Umbra (rule 14) — we pre-check.
//
//   • Self-claimable      ETA → (note) → your own ATA
//       getETAIntoSelfBurnableStealthPoolNoteCreatorFunction. You stay the
//       unlocker and later burn it to your PUBLIC balance on the Claim tab.
//
// Both are ETA-source creators: 2 txs (populate-proof + create) + MPC callback,
// plus a Groth16 proof (createFromEncryptedProver). No auto-deposit here —
// the note is funded from the ETA balance you already shielded.
//
// Critical rules: 1 (no manual generationIndex), 5 (optionalData pre-hashed),
// 9 (mint/pool check), 14 (recipient pre-check for receiver-claimable).

import { useState } from "react";
import {
  getETAIntoReceiverBurnableStealthPoolNoteCreatorFunction,
  getETAIntoSelfBurnableStealthPoolNoteCreatorFunction,
} from "@umbra-privacy/sdk/deposit";
import { Nav } from "@/components/Nav";
import { WalletButton } from "@/components/WalletButton";
import { RegistrationGate } from "@/components/RegistrationGate";
import { PrivacyTierBadge } from "@/components/PrivacyTierBadge";
import { DebugPanel } from "@/components/DebugPanel";
import { useUmbraSession } from "@/app/providers";
import { env } from "@/lib/env";
import { isSupportedMint, findMint } from "@/lib/supported-mints";
import { parseAmount } from "@/lib/amount";
import { createFromEncryptedProver } from "@/lib/zk-prover";
import { formatSdkErrorString } from "@/lib/format-error";
import { checkRecipientRegistration, describeMissing } from "@/lib/recipient-registration-check";
import { dbg, dumpKeyConsistency, dumpUserAccount } from "@/lib/umbra-debug";

type Mode = "receiver" | "self";

type CreateResult = {
  populateProofAccountSignature: unknown;
  queueSignature: unknown;
  callback?: { signature?: unknown };
};

function collect(r: CreateResult): { label: string; sig: string }[] {
  const out = [
    { label: "populate-proof", sig: String(r.populateProofAccountSignature) },
    { label: "create-note (queue)", sig: String(r.queueSignature) },
  ];
  if (r.callback?.signature) out.push({ label: "callback", sig: String(r.callback.signature) });
  return out;
}

export default function TransferPage() {
  const { client, selectedAccount } = useUmbraSession();
  const [mode, setMode] = useState<Mode>("receiver");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [mint, setMint] = useState(env.NEXT_PUBLIC_DEFAULT_MINT);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<readonly { label: string; sig: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const network = env.NEXT_PUBLIC_NETWORK as "mainnet-beta" | "devnet";

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSignatures(null);
    setStep(null);
  }

  async function submit() {
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

    let receiver = selectedAccount.address;
    if (mode === "receiver") {
      receiver = recipient.trim();
      if (!receiver) {
        setError("Enter a recipient address.");
        return;
      }
      if (receiver === selectedAccount.address) {
        setError("Refusing to send to your own wallet — use the self-claimable mode for that.");
        return;
      }
    }

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
      void dumpKeyConsistency(client, "sender wallet");
      dbg("transfer", `${mode} ${meta.symbol} raw ${amountRaw.toString()}`, {
        mode,
        recipient: receiver,
        mint,
        amountRaw: amountRaw.toString(),
      });

      if (mode === "receiver") {
        // Rule 14 — recipient must be fully registered for a receiver-claimable note.
        setStep("Checking recipient registration…");
        const status = await checkRecipientRegistration(client, receiver);
        if (!status.fullyRegistered) {
          setError(
            `Recipient is not fully registered on Umbra (missing: ${describeMissing(status)}). ` +
              `Switch to self-claimable, or ask them to register first.`,
          );
          setStep(null);
          return;
        }
        void dumpUserAccount(client, receiver, "recipient");

        setStep("Creating receiver-claimable note from your ETA (MPC + ZK, ~10–30s)…");
        const create = getETAIntoReceiverBurnableStealthPoolNoteCreatorFunction(
          { client },
          { zkProver: createFromEncryptedProver },
        );
        const res = (await create({
          amount: amountRaw as never,
          destinationAddress: receiver as never,
          mint: mint as never,
        })) as CreateResult;
        setSignatures(collect(res));
      } else {
        setStep("Creating self-claimable note from your ETA (MPC + ZK, ~10–30s)…");
        const create = getETAIntoSelfBurnableStealthPoolNoteCreatorFunction(
          { client },
          { zkProver: createFromEncryptedProver },
        );
        const res = (await create({
          amount: amountRaw as never,
          destinationAddress: selectedAccount.address as never,
          mint: mint as never,
        })) as CreateResult;
        setSignatures(collect(res));
      }
      setStep(null);
      dbg("transfer", `${mode} note created`);
    } catch (e: unknown) {
      const msg = formatSdkErrorString(e);
      console.error("Umbra transfer failed:", msg);
      dbg("transfer", `${mode} FAILED`, e);
      setError(msg);
      setStep(null);
    } finally {
      setSubmitting(false);
    }
  }

  const tier = mode === "self" ? 3 : 2;
  const canSubmit = mode === "receiver" ? Boolean(recipient && amount) : Boolean(amount);

  return (
    <>
      <Nav active="transfer" />
      <h1>3 · Transfer <PrivacyTierBadge tier={tier} /></h1>
      <p className="muted">
        Create a Stealth Pool Note from your <strong>encrypted balance</strong> (fund it on the
        Deposit tab first). Receiver-claimable goes to another registered Umbra user&apos;s ETA;
        self-claimable comes back to your own public balance on the Claim tab.
      </p>

      <div className="card">
        <label>Note type</label>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className={mode === "receiver" ? undefined : "secondary"}
            onClick={() => switchMode("receiver")}
            disabled={submitting}
          >
            Receiver-claimable · ETA → ETA
          </button>
          <button
            className={mode === "self" ? undefined : "secondary"}
            onClick={() => switchMode("self")}
            disabled={submitting}
          >
            Self-claimable · ETA → ATA
          </button>
        </div>
      </div>

      <WalletButton />
      <RegistrationGate>
        <div className="card">
          {mode === "receiver" ? (
            <>
              <label>Recipient address</label>
              <input
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  setError(null);
                }}
                placeholder="Registered Umbra user's Solana address"
                spellCheck={false}
              />
            </>
          ) : (
            <p className="muted">
              Destination: your own wallet — claim it back to your public balance on the Claim
              tab.
            </p>
          )}
          <label>Amount</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
          <label>Mint</label>
          <input value={mint} onChange={(e) => setMint(e.target.value)} spellCheck={false} />
          <p className="muted">{findMint(mint, network)?.symbol ?? "(unsupported)"}</p>

          <button onClick={() => void submit()} disabled={submitting || !canSubmit}>
            {submitting
              ? "Creating note…"
              : mode === "receiver"
                ? "Create receiver-claimable note"
                : "Create self-claimable note"}
          </button>

          {step && <p className="muted">{step}</p>}
          {error && <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>}
          {signatures && (
            <>
              <h2>{mode === "receiver" ? "Receiver-claimable note created" : "Self-claimable note created"}</h2>
              <p className="muted">
                {mode === "receiver"
                  ? "The recipient claims it on their Claim tab."
                  : "Claim it back to your public balance on the Claim tab."}
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
