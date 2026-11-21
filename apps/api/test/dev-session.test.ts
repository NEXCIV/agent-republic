import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createDevSessionResolver } from '../src/index.js';

/**
 * The fixed demo identity must never leak into production and must be
 * UUID-validated before it reaches a database query.
 */

const APP_USER = '11111111-1111-4111-8111-111111111111';
const request = {} as FastifyRequest;

describe('createDevSessionResolver', () => {
  it('denies every request when the demo identity is unset', async () => {
    await expect(createDevSessionResolver({})(request)).resolves.toBeNull();
  });

  it('returns the demo identity outside production', async () => {
    const resolver = createDevSessionResolver({
      DEV_SESSION_APP_USER_ID: APP_USER.toUpperCase(),
      NODE_ENV: 'development',
    });
    await expect(resolver(request)).resolves.toEqual({ appUserId: APP_USER });
  });

  it('rejects a malformed demo identity', () => {
    expect(() => createDevSessionResolver({ DEV_SESSION_APP_USER_ID: 'demo-user' })).toThrow(
      /must be a UUID/,
    );
  });

  it('refuses to enable a fixed identity in production', () => {
    expect(() =>
      createDevSessionResolver({
        DEV_SESSION_APP_USER_ID: APP_USER,
        NODE_ENV: 'production',
      }),
    ).toThrow(/forbidden in production/);
  });
});
