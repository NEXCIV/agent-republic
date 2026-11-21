/**
 * Uniform API error envelope (docs/ARCHITECTURE.md §7.2):
 * `{ error: { code, message, requestId, details? } }`
 */

export type ApiErrorCode =
  | 'INVALID_ADDRESS'
  | 'INVALID_ID'
  | 'INVALID_FILTER'
  | 'INVALID_BODY'
  | 'NOT_FOUND'
  | 'RPC_DOWN'
  | 'DB_UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'UNAUTHENTICATED'
  | 'CHALLENGE_USED'
  | 'CHALLENGE_EXPIRED'
  | 'OWNER_MISMATCH'
  | 'TX_MISMATCH'
  | 'EVENT_NOT_FOUND'
  | 'OWNER_ALREADY_BOUND'
  | 'APP_USER_ALREADY_BOUND'
  | 'OWNER_NOT_BOUND'
  | 'NOT_PREPARABLE'
  | 'INTENT_STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'WORLD_NOT_READY'
  | 'SCENE_NOT_FOUND'
  | 'BINDING_REQUIRED'
  | 'OWNER_NOT_ALLOWED'
  | 'NO_AGENT'
  | 'VERSION_CONFLICT'
  | 'INTERNAL';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
