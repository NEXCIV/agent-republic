import type { SessionResolver } from '../server.js';

/**
 * Local-demo session only (E4 preview, not an auth system).
 *
 * The API has no Web2 login yet. For local UI previews an operator may set
 * `DEV_SESSION_APP_USER_ID`; this is refused outright when NODE_ENV is
 * production so a demo identity can never become a production backdoor.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDevSessionResolver(env: Record<string, string | undefined>): SessionResolver {
  const raw = env.DEV_SESSION_APP_USER_ID?.trim() ?? '';
  if (raw === '') return async () => null;

  if (env.NODE_ENV === 'production') {
    throw new Error('[api] DEV_SESSION_APP_USER_ID is forbidden in production');
  }
  if (!UUID_PATTERN.test(raw)) {
    throw new Error('[api] DEV_SESSION_APP_USER_ID must be a UUID');
  }

  const appUserId = raw.toLowerCase();
  return async () => ({ appUserId });
}
