import { z } from 'zod';
import { evmAddressSchema, type EvmAddress } from '@agent-republic/domain';

/**
 * E0-02 chain config guard.
 *
 * Rules (docs/AGENTS.md §2, docs/ARCHITECTURE.md §0):
 * - BSC Mainnet chainId=56 is the only production chain.
 * - On mainnet the Agent ID contract address is FIXED to the official
 *   deployment from the hackathon announcement. Any other value is rejected.
 * - Production must NOT start with empty Registry/Core addresses; we refuse
 *   to boot instead of falling back to fake/demo contract addresses.
 * - Testnet (97) is allowed only for development with a mock Agent ID contract.
 */

export const BSC_MAINNET_CHAIN_ID = 56;
export const BSC_TESTNET_CHAIN_ID = 97;

/** Official Binance Agent ID contract on BSC Mainnet (hackathon announcement). */
export const OFFICIAL_AGENT_ID_MAINNET_ADDRESS: EvmAddress =
  '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';

export type ChainEnvironment = 'production' | 'development';

export class ChainConfigError extends Error {
  constructor(message: string) {
    super(`[chain-config] ${message}`);
    this.name = 'ChainConfigError';
  }
}

const optionalAddress = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value))
  .pipe(evmAddressSchema.optional());

const chainConfigInputSchema = z.object({
  chainId: z.coerce.number().int(),
  agentIdAddress: z.string().trim().pipe(evmAddressSchema),
  registryAddress: optionalAddress,
  coreAddress: optionalAddress,
  environment: z.enum(['production', 'development']).default('development'),
});

/**
 * Looser manual input type: env vars arrive as strings; Zod coerces and
 * validates at runtime.
 */
export type ChainConfigInput = {
  chainId: number | string;
  agentIdAddress: string;
  registryAddress?: string;
  coreAddress?: string;
  environment?: ChainEnvironment;
};

export type ChainConfig = {
  readonly chainId: 56 | 97;
  readonly networkName: 'BSC Mainnet' | 'BSC Testnet';
  readonly agentIdAddress: EvmAddress;
  readonly registryAddress: EvmAddress | undefined;
  readonly coreAddress: EvmAddress | undefined;
  readonly environment: ChainEnvironment;
  readonly isMainnet: boolean;
};

/**
 * Parse and validate chain configuration. Throws ChainConfigError on any
 * violation — callers must let the process crash rather than continue with
 * a wrong-chain or unverified configuration.
 */
export function parseChainConfig(input: ChainConfigInput): ChainConfig {
  const parsed = chainConfigInputSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ChainConfigError(
      `invalid config field "${first?.path.join('.')}": ${first?.message}`,
    );
  }
  const { chainId, agentIdAddress, registryAddress, coreAddress, environment } = parsed.data;

  if (chainId !== BSC_MAINNET_CHAIN_ID && chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new ChainConfigError(
      `unsupported chainId ${chainId}: only ${BSC_MAINNET_CHAIN_ID} (BSC Mainnet) and ` +
        `${BSC_TESTNET_CHAIN_ID} (BSC Testnet) are allowed; refusing to start`,
    );
  }

  const isMainnet = chainId === BSC_MAINNET_CHAIN_ID;

  if (isMainnet && agentIdAddress !== OFFICIAL_AGENT_ID_MAINNET_ADDRESS) {
    throw new ChainConfigError(
      `mainnet Agent ID address must be the official contract ` +
        `${OFFICIAL_AGENT_ID_MAINNET_ADDRESS}, got ${agentIdAddress}`,
    );
  }

  if (environment === 'production') {
    if (registryAddress === undefined || coreAddress === undefined) {
      throw new ChainConfigError(
        'production requires deployed REGISTRY_ADDRESS and CORE_ADDRESS; ' +
          'refusing to start with missing contract addresses (no fake defaults)',
      );
    }
    if (!isMainnet) {
      throw new ChainConfigError('production is only allowed on BSC Mainnet (chainId=56)');
    }
  }

  return Object.freeze({
    chainId: isMainnet ? 56 : 97,
    networkName: isMainnet ? 'BSC Mainnet' : 'BSC Testnet',
    agentIdAddress,
    registryAddress,
    coreAddress,
    environment,
    isMainnet,
  });
}

/**
 * Load config from environment variables (.env.example keys).
 * Throws on any violation; never returns a partially valid config.
 */
export function parseChainConfigFromEnv(env: Record<string, string | undefined>): ChainConfig {
  const chainIdRaw = env.NEXT_PUBLIC_CHAIN_ID ?? env.CHAIN_ID;
  if (chainIdRaw === undefined || chainIdRaw === '') {
    throw new ChainConfigError('missing NEXT_PUBLIC_CHAIN_ID / CHAIN_ID environment variable');
  }
  return parseChainConfig({
    chainId: chainIdRaw,
    agentIdAddress:
      env.NEXT_PUBLIC_AGENT_ID_ADDRESS ?? env.AGENT_ID_ADDRESS ?? OFFICIAL_AGENT_ID_MAINNET_ADDRESS,
    registryAddress: env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? env.REGISTRY_ADDRESS ?? '',
    coreAddress: env.NEXT_PUBLIC_CORE_ADDRESS ?? env.CORE_ADDRESS ?? '',
    environment: env.NODE_ENV === 'production' ? 'production' : 'development',
  });
}
