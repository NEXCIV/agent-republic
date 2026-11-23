import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { bsc, bscTestnet } from 'viem/chains';
import type { EvmAddress } from '@agent-republic/domain';
import { ChainConfigError, type ChainConfig } from './config.js';

/**
 * E2-03 chain read port.
 *
 * Identity facts (Agent ID ownership, BUILD, REP) MUST come from contract
 * reads — never from a database flag (docs/AGENTS.md §2). The port is injected
 * so route tests can run without an RPC and so the API can fail closed with
 * RPC_DOWN when no endpoint is configured.
 */

export type CitizenChainState = {
  readonly hasAgentId: boolean;
  readonly build: bigint;
  readonly rep: bigint;
  readonly registered: boolean;
};

export interface CommandIdentityReader {
  readCanonicalHash(block: bigint): Promise<string>;
  readCommandIdentity(owner: EvmAddress, block: bigint): Promise<CitizenChainState & {
    eligibleNow: boolean;
    networkBlockNumber: bigint;
    blockHash: string;
  }>;
}

export interface ChainReadPort {
  readCitizenState(owner: EvmAddress): Promise<CitizenChainState>;
  /**
   * Receipt lookup used by `GET /tx/:hash`. Returns null when the node has no
   * receipt for the hash; throws ChainReadError when the RPC itself failed.
   */
  readTransactionReceipt(txHash: string): Promise<TransactionReceipt | null>;
}

export type TransactionReceipt = {
  readonly status: 'SUCCESS' | 'REVERTED';
  readonly blockNumber: bigint;
};

export type ChainReadErrorCode = 'RPC_DOWN' | 'BAD_RESPONSE';

export class ChainReadError extends Error {
  constructor(
    readonly code: ChainReadErrorCode,
    message: string,
  ) {
    super(`[chain-read] ${message}`);
    this.name = 'ChainReadError';
  }
}

// docs/SMART_CONTRACTS.md §2 (IAgentID) and §5.9 (getCitizenState).
const AGENT_ID_ABI = parseAbi([
  'function balanceOf(address owner) external view returns (uint256)',
]);

const CORE_ABI = parseAbi([
  'function getCitizenState(address owner) external view returns (uint256 build, uint256 rep, bool registered)',
]);

const asAddress = (value: EvmAddress): Address => value as Address;

export function createViemChainReader(config: ChainConfig, rpcUrl: string): ChainReadPort & CommandIdentityReader {
  if (rpcUrl.trim() === '') {
    throw new ChainConfigError('an RPC URL is required for chain reads');
  }
  if (config.coreAddress === undefined) {
    throw new ChainConfigError('CORE_ADDRESS is required to read citizen state (no fake defaults)');
  }
  const coreAddress = config.coreAddress;

  const client = createPublicClient({
    chain: config.chainId === 56 ? bsc : bscTestnet,
    transport: http(rpcUrl, { timeout: 10_000, retryCount: 1 }),
  });

  async function readCitizenState(owner: EvmAddress, blockNumber?: bigint): Promise<CitizenChainState> {
    try {
      const [agentIdBalance, citizenState] = await Promise.all([
        client.readContract({
          blockNumber, address: asAddress(config.agentIdAddress), abi: AGENT_ID_ABI,
          functionName: 'balanceOf', args: [asAddress(owner)],
        }),
        client.readContract({
          blockNumber, address: asAddress(coreAddress), abi: CORE_ABI,
          functionName: 'getCitizenState', args: [asAddress(owner)],
        }),
      ]);
      const [build, rep, registered] = citizenState;
      return { hasAgentId: agentIdBalance > 0n, build, rep, registered };
    } catch (error) {
      throw new ChainReadError(
        'RPC_DOWN',
        `failed to read citizen state for ${owner}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    readCitizenState,
    async readCanonicalHash(blockNumber) {
      const block = await client.getBlock({ blockNumber });
      if (!block.hash) throw new ChainReadError('BAD_RESPONSE', 'Missing canonical block hash.');
      return block.hash;
    },
    async readCommandIdentity(owner, blockNumber) {
      try {
        const [chainId, before, current] = await Promise.all([
          client.getChainId(), client.getBlock({ blockNumber }), readCitizenState(owner),
        ]);
        if (chainId !== config.chainId) throw new Error('unexpected chain');
        const state = await readCitizenState(owner, blockNumber);
        const [after, networkBlockNumber] = await Promise.all([
          client.getBlock({ blockNumber }), client.getBlockNumber({ cacheTime: 0 }),
        ]);
        if (!after.hash || before.hash !== after.hash) throw new Error('block changed during identity read');
        return { ...state, eligibleNow: current.hasAgentId && current.registered, networkBlockNumber, blockHash: after.hash };
      } catch {
        throw new ChainReadError('RPC_DOWN', 'could not verify command identity at the observed block');
      }
    },

    async readTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
      try {
        const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
        return {
          status: receipt.status === 'success' ? 'SUCCESS' : 'REVERTED',
          blockNumber: receipt.blockNumber,
        };
      } catch (error) {
        // viem throws TransactionReceiptNotFoundError for unknown hashes —
        // that is a normal "not mined yet" answer, not an RPC failure.
        if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') {
          return null;
        }
        throw new ChainReadError(
          'RPC_DOWN',
          `failed to read receipt for ${txHash}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
