import { createViemChainReader, parseChainConfigFromEnv } from '@agent-republic/chain';
import { BindingService } from './auth/binding.js';
import { createDevSessionResolver } from './auth/dev-session.js';
import { PostgresBindingRepository } from './auth/postgres-repository.js';
import { IntentService } from './intents/intents.js';
import { PostgresIntentRepository } from './intents/postgres-repository.js';
import { PostgresWorldReader } from './world/world-reader.js';
import { WorldService } from './world/world-service.js';
import { AgentConsoleService } from './agents/agent-console.js';
import { PostgresAgentConsoleRepository } from './agents/postgres-repository.js';
import { CommandService, readCommandContext } from './agents/commands.js';
import { PgCommandStore } from './agents/command-store.js';
import { LocalCommandModel } from './agents/command-model.js';
import { ApiError } from './errors.js';
import { buildApiServer, type ApiDeps } from './server.js';
import { PostgresProjectionReader } from './repositories/postgres.js';

/**
 * API entrypoint. E0-02 acceptance is preserved: the process refuses to start
 * on a wrong-chain or unverified configuration instead of silently connecting
 * elsewhere. E2-03 adds the read-only HTTP surface.
 */

export const API_APP_ROLE = 'api';

export { buildApiServer } from './server.js';
export type { ApiDeps, SessionResolver } from './server.js';
export { ApiError } from './errors.js';
export { BindingService, CHALLENGE_TTL_SECONDS } from './auth/binding.js';
export { createDevSessionResolver } from './auth/dev-session.js';
export type {
  BindingPort,
  BindingRepository,
  ChallengeResponse,
  CommitOutcome,
  CreateChallengeInput,
  VerifyBindingInput,
  VerifyResult,
} from './auth/binding.js';
export { PostgresBindingRepository } from './auth/postgres-repository.js';
export { IntentService, isIntent } from './intents/intents.js';
export type {
  IntentRepository,
  IntentRow,
  IntentServiceDeps,
  IntentStatus,
  PreparedIntent,
  TxStatus,
  TxStatusResult,
} from './intents/intents.js';
export { PostgresIntentRepository } from './intents/postgres-repository.js';
export { WorldService } from './world/world-service.js';
export type { WorldServiceDeps, WorldSummary } from './world/world-service.js';
export { PostgresWorldReader } from './world/world-reader.js';
export type { WorldRawData, WorldReader } from './world/world-reader.js';
export { AgentConsoleService, AgentVersionConflictError } from './agents/agent-console.js';
export type {
  AgentActionView,
  AgentConfigInput,
  AgentConfigSaveResult,
  AgentConfigVersionView,
  AgentConsoleRepository,
  AgentConsoleView,
  AgentStatus,
} from './agents/agent-console.js';
export { PostgresAgentConsoleRepository } from './agents/postgres-repository.js';
export { PostgresProjectionReader } from './repositories/postgres.js';
export type {
  ApiProjectionReader,
  ContributorRow,
  IdentityProjection,
  ProposalRow,
  ProjectRow,
  SyncState,
  SyncStatus,
  TxLink,
  VoteTally,
} from './ports.js';

/** Called at server startup; throws ChainConfigError on invalid env. */
export function assertStartupChainConfig(env: Record<string, string | undefined>): void {
  parseChainConfigFromEnv(env);
}

function parseConfirmations(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 12;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 12;
}

/**
 * Build the API from environment variables.
 * Missing DATABASE_URL or malformed chain config throws — no fake defaults.
 * Without a BSC RPC URL the identity route fails closed with RPC_DOWN.
 */
export function createApiFromEnv(env: Record<string, string | undefined>) {
  const config = parseChainConfigFromEnv(env);
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('[api] DATABASE_URL is required; refusing to start without a database');
  }

  const reader = new PostgresProjectionReader(databaseUrl);
  const rpcUrl = env.BSC_RPC_URL ?? env.RPC_URL ?? '';
  const chain = rpcUrl.trim() === '' ? null : createViemChainReader(config, rpcUrl);
  const agents = new AgentConsoleService(new PostgresAgentConsoleRepository(databaseUrl));
  const world = new WorldService({
    reader: new PostgresWorldReader(databaseUrl),
    chainId: config.chainId,
    confirmedDepth: parseConfirmations(env.CONFIRMATIONS_REQUIRED),
    worldSeedFallback: env.WORLD_SEED,
  });
  const store = new PgCommandStore(databaseUrl);
  const model = env.COMMAND_LOCAL_MODEL?.trim();
  const localModel = model ? new LocalCommandModel(
    model, Number(env.COMMAND_MODEL_DAILY_CALLS ?? 30), (call) => store.reserveModelCall(call),
  ) : undefined;
  const commands = new CommandService(agents, store, (agent) => readCommandContext(agent, world, chain),
    localModel, chain?.readCanonicalHash);
  const deps: ApiDeps = {
    chainId: config.chainId,
    reader,
    chain,
    binding: new BindingService({
      repo: new PostgresBindingRepository(databaseUrl),
      chainId: config.chainId,
      registryAddress: config.registryAddress,
    }),
    intents: new IntentService({
      repo: new PostgresIntentRepository(databaseUrl),
      chainId: config.chainId,
      coreAddress: config.coreAddress,
      chain,
    }),
    world, agents, commands,
    // No passkey/email session layer exists yet. The default resolver denies
    // every request; a local demo may opt into a fixed identity through
    // DEV_SESSION_APP_USER_ID, which is forbidden in production.
    session: createDevSessionResolver(env),
    logger: env.NODE_ENV !== 'test',
  };
  const app = buildApiServer(deps);
  let timer: ReturnType<typeof setInterval> | undefined;
  let batch: Promise<void> | undefined;
  const onError = (error: unknown) => {
    const code = error instanceof ApiError ? error.code : 'UNAVAILABLE';
    app.log.warn({ code }, 'Command dispatch deferred');
  };
  app.addHook('onListen', async () => {
    if (!chain) return;
    timer = setInterval(() => {
      if (batch) return;
      batch = commands.dispatch(onError).catch(onError).finally(() => { batch = undefined; });
    }, 4000);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await batch;
    await store.close();
  });
  return app;
}
