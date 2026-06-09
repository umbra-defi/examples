"use client";

// Tier 1 = EncryptedTokenAccount → EncryptedTokenAccount  (strongest; both ends shielded)
// Tier 2 = PATA ↔ EncryptedTokenAccount                    (one end visible)
// Tier 3 = PATA → PATA                                     (weakest; amounts fully observable)
// See reference/privacy.md.

export type PrivacyTier = 1 | 2 | 3;

export function PrivacyTierBadge({ tier }: { tier: PrivacyTier }) {
  const labels: Record<PrivacyTier, string> = {
    1: "Tier 1 · strongest",
    2: "Tier 2 · mixed",
    3: "Tier 3 · weakest",
  };
  return <span className={`badge tier${tier}`}>{labels[tier]}</span>;
}

export function tierFor(args: { sourceShielded: boolean; destinationShielded: boolean }): PrivacyTier {
  if (args.sourceShielded && args.destinationShielded) return 1;
  if (args.sourceShielded || args.destinationShielded) return 2;
  return 3;
}
