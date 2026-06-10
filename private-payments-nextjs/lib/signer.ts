// Adapt a connected Wallet Standard wallet to an IUmbraSigner.
//
// We deliberately do NOT use the SDK's `createSignerFromWalletAccount` here.
// That adapter signs by grafting the wallet's returned signature back onto the
// ORIGINAL message:
//
//     return { ...transaction, signatures: { ...transaction.signatures, ...decoded.signatures } };
//
// That breaks on Solflare. Solflare (with "automatically optimize transactions"
// / auto priority-fee enabled — on by default, and it only fires under network
// load, hence the *intermittent* failures) MUTATES the message before signing,
// adding its own ComputeBudget instruction. Its signature is then computed over
// the modified message, but the SDK re-attaches that signature to the original,
// unmodified message → the signature no longer matches the bytes →
// "Transaction did not pass signature verification" (SolanaError 7050012), a
// preflight failure with empty logs.
//
// The fix below returns the WALLET'S OWN decoded transaction (message AND
// signatures together) whenever the wallet changed the message, so the bytes we
// submit always match the bytes the wallet signed. When the message is
// unchanged we keep any pre-existing (e.g. co-signer) signatures and only
// overlay the wallet's non-null ones. Either way we preserve the blockhash
// lifetime constraint the SDK attached (Solflare leaves the blockhash intact).

import { address, getTransactionDecoder, getTransactionEncoder } from "@solana/kit";
import type { IUmbraSigner } from "@umbra-privacy/sdk";
import {
  SolanaSignMessage,
  SolanaSignTransaction,
} from "@solana/wallet-standard-features";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

// Derive the exact transaction types the SDK expects from the interface, so we
// don't depend on the (un-exported) branded `SignedTransaction` name.
type Signable = Parameters<IUmbraSigner["signTransaction"]>[0];
type Signed = Awaited<ReturnType<IUmbraSigner["signTransaction"]>>;
type SigMap = Signable["signatures"];
type SignedMsg = Awaited<ReturnType<IUmbraSigner["signMessage"]>>;

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Drop signer slots whose signature is null/undefined so a wallet that returns
// a full signature map with blanks for keys it doesn't own can't clobber a
// signature we already applied.
function nonNullSignatures(sigs: SigMap): SigMap {
  const out: Record<string, Uint8Array> = {};
  for (const [addr, sig] of Object.entries(sigs)) {
    if (sig != null) out[addr] = sig as Uint8Array;
  }
  return out as SigMap;
}

export function umbraSignerFromWallet(
  wallet: Wallet,
  account: WalletAccount,
): IUmbraSigner {
  const signTx = wallet.features[SolanaSignTransaction] as
    | { signTransaction: (...inputs: { account: WalletAccount; transaction: Uint8Array }[]) => Promise<{ signedTransaction: Uint8Array }[]> }
    | undefined;
  const signMsg = wallet.features[SolanaSignMessage] as
    | { signMessage: (input: { account: WalletAccount; message: Uint8Array }) => Promise<{ signature: Uint8Array }[]> }
    | undefined;

  if (!signTx) {
    throw new Error(`Wallet "${wallet.name}" does not support ${SolanaSignTransaction}.`);
  }
  if (!signMsg) {
    throw new Error(`Wallet "${wallet.name}" does not support ${SolanaSignMessage}.`);
  }

  const encoder = getTransactionEncoder();
  const decoder = getTransactionDecoder();

  // Reconcile the wallet's signed output with the transaction we sent. If the
  // wallet kept the message identical, preserve any co-signer signatures we
  // already had; if it changed the message (Solflare priority-fee injection),
  // adopt the wallet's transaction verbatim so message and signature agree.
  // The blockhash lifetime is always carried over from the original.
  function reconcile(original: Signable, signedBytes: Uint8Array): Signed {
    const decoded = decoder.decode(signedBytes);
    const decodedMsg = decoded.messageBytes as unknown as Uint8Array;
    const originalMsg = original.messageBytes as unknown as Uint8Array;
    if (sameBytes(decodedMsg, originalMsg)) {
      return {
        ...original,
        signatures: {
          ...nonNullSignatures(original.signatures),
          ...nonNullSignatures(decoded.signatures as unknown as SigMap),
        },
      } as unknown as Signed;
    }
    return {
      ...decoded,
      lifetimeConstraint: original.lifetimeConstraint,
    } as unknown as Signed;
  }

  return {
    address: address(account.address),
    async signTransaction(transaction) {
      const wireBytes = encoder.encode(transaction) as Uint8Array;
      const [output] = await signTx.signTransaction({ account, transaction: wireBytes });
      if (!output) throw new Error(`Wallet "${wallet.name}" returned no signed transaction.`);
      return reconcile(transaction, output.signedTransaction);
    },
    async signTransactions(transactions) {
      const inputs = transactions.map((tx) => ({
        account,
        transaction: encoder.encode(tx) as Uint8Array,
      }));
      const outputs = await signTx.signTransaction(...inputs);
      return transactions.map((tx, i) => {
        const output = outputs[i];
        if (!output) throw new Error(`Wallet "${wallet.name}" returned no signed transaction at index ${i}.`);
        return reconcile(tx, output.signedTransaction);
      });
    },
    async signMessage(message) {
      const [output] = await signMsg.signMessage({ account, message });
      if (!output) throw new Error(`Wallet "${wallet.name}" returned no signed message.`);
      return {
        message,
        signature: output.signature as SignedMsg["signature"],
        signer: address(account.address),
      };
    },
  };
}
