import { z } from "zod";

// Browser-facing indexer/relayer URLs are RELATIVE proxy paths
// (`/proxy/indexer`, `/proxy/relayer`) — same-origin to avoid CORS and
// hide client IPs. The actual upstream hosts live in server-only
// `INDEXER_UPSTREAM` / `RELAYER_UPSTREAM` env vars (see next.config.ts).
const schema = z.object({
  NEXT_PUBLIC_NETWORK: z.enum(["mainnet-beta", "devnet", "localnet"]),
  NEXT_PUBLIC_RPC_URL: z.string().url(),
  NEXT_PUBLIC_RPC_WS_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  NEXT_PUBLIC_DEFAULT_MINT: z.string().min(32).max(44),
  NEXT_PUBLIC_INDEXER_URL: z.string().min(1),
  NEXT_PUBLIC_RELAYER_URL: z.string().min(1),
  // How the SDK waits for transaction confirmation + Arcium MPC callbacks:
  //   - "polling"   — HTTP getSignatureStatuses / getAccountInfo loops. Works
  //     on ANY RPC, including the public `api.devnet.solana.com` whose
  //     WebSocket endpoint throttles/refuses subscriptions ("Failed to
  //     establish WebSocket subscription"). This is the safe default.
  //   - "websocket" — real-time account/signature subscriptions. Lower latency
  //     and fewer RPC calls, but requires a WS-capable RPC (Helius, Triton,
  //     QuickNode, a local validator, …). Set NEXT_PUBLIC_RPC_WS_URL too.
  NEXT_PUBLIC_RPC_TRANSPORT: z
    .enum(["polling", "websocket"])
    .optional()
    .default("polling"),
});

const raw = {
  NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_RPC_WS_URL: process.env.NEXT_PUBLIC_RPC_WS_URL,
  NEXT_PUBLIC_DEFAULT_MINT: process.env.NEXT_PUBLIC_DEFAULT_MINT,
  NEXT_PUBLIC_INDEXER_URL: process.env.NEXT_PUBLIC_INDEXER_URL,
  NEXT_PUBLIC_RELAYER_URL: process.env.NEXT_PUBLIC_RELAYER_URL,
  NEXT_PUBLIC_RPC_TRANSPORT: process.env.NEXT_PUBLIC_RPC_TRANSPORT,
};

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(
    `Invalid environment configuration. Copy .env.example to .env.local and set:\n${issues}`,
  );
}

export const env = parsed.data;

export function deriveWsUrl(): string {
  if (env.NEXT_PUBLIC_RPC_WS_URL) return env.NEXT_PUBLIC_RPC_WS_URL;
  return env.NEXT_PUBLIC_RPC_URL.replace(/^http/, "ws");
}

export function rpcTransport(): "polling" | "websocket" {
  return env.NEXT_PUBLIC_RPC_TRANSPORT;
}

export type Network = "mainnet" | "devnet" | "localnet";

export function umbraNetwork(): Network {
  if (env.NEXT_PUBLIC_NETWORK === "mainnet-beta") return "mainnet";
  if (env.NEXT_PUBLIC_NETWORK === "devnet") return "devnet";
  return "localnet";
}
