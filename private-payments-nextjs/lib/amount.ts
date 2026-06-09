// Parse a human-entered decimal string into base units for a mint's decimals.
// e.g. parseAmount("1.5", 6) === 1_500_000n. Throws (via BigInt) on
// non-numeric input — callers wrap in try/catch and surface "Invalid amount".
//
// Truncates excess fractional digits beyond `decimals` (does not round).
export function parseAmount(amount: string, decimals: number): bigint {
  const [wholeStr, fracStr = ""] = amount.trim().split(".");
  const whole = wholeStr === "" ? "0" : (wholeStr ?? "0");
  const padded = (fracStr + "0".repeat(decimals)).slice(0, decimals) || "0";
  return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(padded);
}
