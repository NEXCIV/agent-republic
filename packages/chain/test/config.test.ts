import { describe, expect, it } from 'vitest';
import {
  BSC_MAINNET_CHAIN_ID,
  BSC_TESTNET_CHAIN_ID,
  ChainConfigError,
  OFFICIAL_AGENT_ID_MAINNET_ADDRESS,
  parseChainConfig,
  parseChainConfigFromEnv,
} from '../src/index.js';

const REGISTRY = '0x1111111111111111111111111111111111111111';
const CORE = '0x2222222222222222222222222222222222222222';
const MOCK_AGENT_ID = '0x3333333333333333333333333333333333333333';

const validMainnet = {
  chainId: BSC_MAINNET_CHAIN_ID,
  agentIdAddress: OFFICIAL_AGENT_ID_MAINNET_ADDRESS,
  registryAddress: REGISTRY,
  coreAddress: CORE,
};

describe('parseChainConfig', () => {
  it('accepts a valid mainnet config with the official Agent ID address', () => {
    const config = parseChainConfig(validMainnet);
    expect(config.chainId).toBe(56);
    expect(config.isMainnet).toBe(true);
    expect(config.agentIdAddress).toBe(OFFICIAL_AGENT_ID_MAINNET_ADDRESS);
    expect(config.registryAddress).toBe(REGISTRY);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('normalizes addresses to lowercase', () => {
    const config = parseChainConfig({
      ...validMainnet,
      registryAddress: REGISTRY.toUpperCase(),
    });
    expect(config.registryAddress).toBe(REGISTRY);
  });

  it('rejects Ethereum mainnet (chainId=1) — wrong chain must not start', () => {
    expect(() =>
      parseChainConfig({
        ...validMainnet,
        chainId: 1,
      }),
    ).toThrow(ChainConfigError);
  });

  it('rejects any unsupported chainId', () => {
    for (const chainId of [0, 137, 8453, 56.5, -1]) {
      expect(() => parseChainConfig({ ...validMainnet, chainId })).toThrow(ChainConfigError);
    }
  });

  it('rejects a mainnet config whose Agent ID address is not the official contract', () => {
    expect(() =>
      parseChainConfig({
        ...validMainnet,
        agentIdAddress: MOCK_AGENT_ID,
      }),
    ).toThrow(/official contract/i);
  });

  it('rejects malformed addresses', () => {
    expect(() =>
      parseChainConfig({ ...validMainnet, agentIdAddress: '0x123' }),
    ).toThrow(ChainConfigError);
    expect(() =>
      parseChainConfig({ ...validMainnet, registryAddress: 'not-an-address' }),
    ).toThrow(ChainConfigError);
  });

  it('allows testnet with a mock Agent ID contract in development', () => {
    const config = parseChainConfig({
      chainId: BSC_TESTNET_CHAIN_ID,
      agentIdAddress: MOCK_AGENT_ID,
      registryAddress: REGISTRY,
      coreAddress: CORE,
      environment: 'development',
    });
    expect(config.isMainnet).toBe(false);
    expect(config.networkName).toBe('BSC Testnet');
  });

  it('allows development mainnet without deployed registry/core (pre-deploy phase)', () => {
    const config = parseChainConfig({
      chainId: BSC_MAINNET_CHAIN_ID,
      agentIdAddress: OFFICIAL_AGENT_ID_MAINNET_ADDRESS,
      registryAddress: '',
      coreAddress: '',
      environment: 'development',
    });
    expect(config.registryAddress).toBeUndefined();
    expect(config.coreAddress).toBeUndefined();
  });

  it('refuses production start when registry or core address is missing', () => {
    expect(() =>
      parseChainConfig({ ...validMainnet, registryAddress: '', environment: 'production' }),
    ).toThrow(/refusing to start/i);
    expect(() =>
      parseChainConfig({ ...validMainnet, coreAddress: '', environment: 'production' }),
    ).toThrow(/refusing to start/i);
  });

  it('refuses production on non-mainnet chains', () => {
    expect(() =>
      parseChainConfig({
        chainId: BSC_TESTNET_CHAIN_ID,
        agentIdAddress: MOCK_AGENT_ID,
        registryAddress: REGISTRY,
        coreAddress: CORE,
        environment: 'production',
      }),
    ).toThrow(ChainConfigError);
  });
});

describe('parseChainConfigFromEnv', () => {
  it('parses the .env.example variable names', () => {
    const config = parseChainConfigFromEnv({
      NEXT_PUBLIC_CHAIN_ID: '56',
      NEXT_PUBLIC_AGENT_ID_ADDRESS: OFFICIAL_AGENT_ID_MAINNET_ADDRESS,
      NEXT_PUBLIC_REGISTRY_ADDRESS: REGISTRY,
      NEXT_PUBLIC_CORE_ADDRESS: CORE,
    });
    expect(config.chainId).toBe(56);
  });

  it('crashes on env pointing at the wrong chain', () => {
    expect(() =>
      parseChainConfigFromEnv({
        NEXT_PUBLIC_CHAIN_ID: '1',
        NEXT_PUBLIC_AGENT_ID_ADDRESS: OFFICIAL_AGENT_ID_MAINNET_ADDRESS,
      }),
    ).toThrow(ChainConfigError);
  });

  it('production env without deployed contracts refuses to boot', () => {
    expect(() =>
      parseChainConfigFromEnv({
        NODE_ENV: 'production',
        NEXT_PUBLIC_CHAIN_ID: '56',
        NEXT_PUBLIC_AGENT_ID_ADDRESS: OFFICIAL_AGENT_ID_MAINNET_ADDRESS,
        NEXT_PUBLIC_REGISTRY_ADDRESS: '',
        NEXT_PUBLIC_CORE_ADDRESS: '',
      }),
    ).toThrow(/refusing to start/i);
  });
});
