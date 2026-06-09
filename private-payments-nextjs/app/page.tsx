import Link from "next/link";
import { Nav } from "@/components/Nav";

export default function HomePage() {
  return (
    <>
      <Nav />
      <h1>Umbra Private Payments</h1>
      <p>Private payments on Solana, powered by Umbra. Five steps:</p>
      <div className="card">
        <h2>Get started</h2>
        <ol>
          <li>
            <Link href="/register">1 · Register</Link> — connect your wallet, register on Umbra
            (and rotate keys to the current version if needed).
          </li>
          <li>
            <Link href="/deposit">2 · Deposit</Link> — move public tokens (ATA) into your
            encrypted balance (ETA).
          </li>
          <li>
            <Link href="/transfer">3 · Transfer</Link> — create a Stealth Pool Note from your ETA:
            receiver-claimable (→ someone&apos;s ETA) or self-claimable (→ your ATA).
          </li>
          <li>
            <Link href="/claim">4 · Claim</Link> — scan + burn notes addressed to you.
          </li>
          <li>
            <Link href="/withdraw">5 · Withdraw</Link> — unshield ETA → your public ATA.
          </li>
        </ol>
        <p className="muted">
          The first time you connect, you&apos;ll sign the Umbra message — this deterministically
          derives your viewing keys. The signature does NOT authorise any spend; it&apos;s read-only.
        </p>
      </div>
    </>
  );
}
