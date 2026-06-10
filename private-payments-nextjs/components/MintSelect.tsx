"use client";

// Token picker — shows human symbols (USDC, USDT, …) and maps internally to the
// mint address. The app never asks the user to paste a mint address; the value
// passed up via onChange is always the correct on-chain mint for the network.

import { SUPPORTED_MINTS } from "@/lib/supported-mints";
import { env } from "@/lib/env";

const MINTS = SUPPORTED_MINTS.filter((m) => m.network === env.NEXT_PUBLIC_NETWORK);

export function MintSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (mint: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      spellCheck={false}
      style={{ marginBottom: 16, display: "block" }}
    >
      {MINTS.map((m) => (
        <option key={m.mint} value={m.mint}>
          {m.symbol}
        </option>
      ))}
    </select>
  );
}
