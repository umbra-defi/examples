// Surface the actual on-chain reason from any shape Solana / Umbra
// errors arrive in. Without this, every simulation failure looks
// identical ("Failed to send transaction"). Critical for diagnosing
// 3012 (AccountNotInitialized → mint pool not deployed; pitfalls.md §13),
// custom program errors, ZK proof rejections, and Arcium MPC failures.

interface MaybeWithLogs {
  logs?: readonly string[];
  transactionLogs?: readonly string[];
  cause?: unknown;
  context?: { logs?: readonly string[] };
  data?: { logs?: readonly string[] };
  message?: string;
}

function extractLogs(err: unknown, depth = 0): readonly string[] {
  if (depth > 5 || !err || typeof err !== "object") return [];
  const e = err as MaybeWithLogs;
  if (Array.isArray(e.logs)) return e.logs;
  if (Array.isArray(e.transactionLogs)) return e.transactionLogs;
  if (Array.isArray(e.context?.logs)) return e.context.logs;
  if (Array.isArray(e.data?.logs)) return e.data.logs;
  if (e.cause) return extractLogs(e.cause, depth + 1);
  return [];
}

function extractAnchorErrorCode(logs: readonly string[]): number | null {
  for (const line of logs) {
    const m = line.match(/Error Number:\s*(\d+)/) ?? line.match(/custom program error:\s*0x([0-9a-fA-F]+)/);
    if (m && m[1]) {
      const n = m[0].includes("0x") ? parseInt(m[1], 16) : parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

const ANCHOR_HINTS: Record<number, string> = {
  3012: "AccountNotInitialized: the protocol pool / fee_schedule for this mint isn't deployed on this cluster. Pick a different mint or check pitfalls.md §13.",
  3010: "AccountNotInitialized (legacy code) — same diagnosis as 3012.",
  3014: "AccountOwnedByWrongProgram: a PDA you derived points at the wrong program. Check the network arg matches your RPC cluster.",
};

// Walk the cause chain, surfacing each level's name + message + any
// code/stage/field/context. Many SDK + @solana/kit errors carry the real
// reason (e.g. which account is invalid, the SolanaError code) in `cause` /
// `context`, NOT in `logs`.
function extractCauseChain(err: unknown, depth = 0): string[] {
  if (depth > 6 || err == null) return [];
  if (typeof err !== "object") return [String(err)];
  const e = err as {
    name?: string;
    message?: string;
    code?: unknown;
    stage?: unknown;
    field?: unknown;
    context?: unknown;
    cause?: unknown;
  };
  const name = e.name ?? (e as { constructor?: { name?: string } }).constructor?.name ?? "Error";
  const extras: string[] = [];
  if (e.code !== undefined) extras.push(`code=${safeJson(e.code)}`);
  if (e.stage !== undefined) extras.push(`stage=${safeJson(e.stage)}`);
  if (e.field !== undefined) extras.push(`field=${safeJson(e.field)}`);
  if (e.context !== undefined) extras.push(`context=${safeJson(e.context)}`);
  let line = `[${name}] ${e.message ?? ""}`.trim();
  if (extras.length) line += `  (${extras.join(", ")})`;
  return [line, ...extractCauseChain(e.cause, depth + 1)];
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
  } catch {
    return String(v);
  }
}

export interface FormattedSdkError {
  message: string;
  anchorCode: number | null;
  hint: string | null;
  logs: readonly string[];
  causeChain: readonly string[];
}

export function formatSdkError(err: unknown): FormattedSdkError {
  const baseMessage = err instanceof Error ? err.message : String(err);
  const logs = extractLogs(err);
  const anchorCode = extractAnchorErrorCode(logs);
  const hint = anchorCode !== null ? (ANCHOR_HINTS[anchorCode] ?? null) : null;
  return {
    message: baseMessage,
    anchorCode,
    hint,
    logs,
    causeChain: extractCauseChain(err),
  };
}

export function formatSdkErrorString(err: unknown): string {
  const f = formatSdkError(err);
  const parts = [f.message];
  if (f.anchorCode !== null) parts.push(`Anchor code: ${f.anchorCode}`);
  if (f.hint) parts.push(`Hint: ${f.hint}`);
  // The cause chain often carries the real reason (which account, SolanaError code)
  // when there are no program logs. Show it when it adds detail beyond the message.
  if (f.causeChain.length > 1 || (f.causeChain[0] && !f.causeChain[0].includes(f.message))) {
    parts.push("Detail:\n  " + f.causeChain.join("\n  "));
  }
  if (f.logs.length > 0) parts.push("Program logs:\n  " + f.logs.join("\n  "));
  return parts.join("\n");
}
