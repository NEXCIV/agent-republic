/**
 * Worker entry — BullMQ queues land in Epic E2/E3 (docs/ARCHITECTURE.md §8).
 * The chain indexer (E2-02) lives in ./indexer and is intentionally pure of
 * scheduling concerns so it can be invoked by the queue or by tests.
 */

export const WORKER_APP_ROLE = 'worker';

export * from './indexer/index.js';
export { WorldTickStore } from './world/tick-store.js';
export type {
  ClaimTickInput,
  StoredTick,
  VisualEventInput,
} from './world/tick-store.js';
export { WorldRecovery } from './world/recovery.js';
export type { WorldRecoveryResult } from './world/recovery.js';
