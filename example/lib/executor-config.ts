// Build a TransactionExecutorConfig from an already-constructed Umbra client.
//
// Shared-sender confidential transfers (getTransferorFunction) submit the queue
// transaction INSIDE the SDK and therefore require an executor config; without
// one the SDK throws TRANSFER_MISSING_EXECUTOR_CONFIG. The config is just the
// transaction-plumbing the client already holds, so we lift it straight off the
// client — crucially including its transactionForwarder + computationMonitor,
// which are the POLLING implementations wired in lib/umbra-client.ts. That keeps
// transfer confirmation off WebSockets (see the rpc-transport fix), same as the
// deposit/withdraw paths which build this config internally.
//
// (The ETA→ATA withdrawer builds its own executor config from the client, so it
// does NOT need this helper — only the transferor does.)

import type { IUmbraClient } from "@umbra-privacy/sdk";
import type { TransactionExecutorConfig } from "@umbra-privacy/sdk/pipeline";

export function buildExecutorConfig(client: IUmbraClient): TransactionExecutorConfig {
  return {
    signer: client.signer,
    getLatestBlockhash: client.blockhashProvider,
    transactionForwarder: client.transactionForwarder,
    computationMonitor: client.computationMonitor,
  };
}
