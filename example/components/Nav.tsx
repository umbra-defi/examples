"use client";

// Shared top navigation — one source of truth for the 5-step tab list.
// Pass the current tab's `active` key to highlight it.
//
// Tab → SDK operation (the 5 private-payment steps):
//   Register — user registration + key rotation/restore        (/register)
//   Deposit  — public ATA → your EncryptedTokenAccount (ETA)    (/deposit)
//   Transfer — ETA → Stealth Pool Note: receiver-claimable (→ recipient's ETA)
//              or self-claimable (→ your own ATA on Claim)       (/transfer)
//   Claim    — scan + burn incoming/own notes                   (/claim)
//   Withdraw — ETA → your public ATA (unshield)                 (/withdraw)

import Link from "next/link";

export type NavKey = "register" | "deposit" | "transfer" | "claim" | "withdraw";

const TABS: readonly { key: NavKey; href: string; label: string }[] = [
  { key: "register", href: "/register", label: "1 · Register" },
  { key: "deposit", href: "/deposit", label: "2 · Deposit" },
  { key: "transfer", href: "/transfer", label: "3 · Transfer" },
  { key: "claim", href: "/claim", label: "4 · Claim" },
  { key: "withdraw", href: "/withdraw", label: "5 · Withdraw" },
];

export function Nav({ active }: { active?: NavKey }) {
  return (
    <nav>
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className={active === t.key ? "active" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
