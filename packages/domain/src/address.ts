import { z } from 'zod';

/**
 * Canonical EVM address schema. Lives in its own module so that
 * world-v1.ts can import it without creating a circular dependency with
 * the package barrel.
 */
export const evmAddressSchema = z
  .string()
  .regex(/^0[xX][0-9a-fA-F]{40}$/, 'must be a 42-char EVM address')
  .transform((value) => value.toLowerCase());

export type EvmAddress = z.output<typeof evmAddressSchema>;
