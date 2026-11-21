import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { evmAddressSchema, PROPOSAL_STATUSES, type ProposalStatus } from '@agent-republic/domain';
import { ChainReadError, type ChainReadPort, type CitizenChainState } from '@agent-republic/chain';
import { getSceneManifest, SceneManifestError } from '@agent-republic/world-engine';
import { ApiError } from './errors.js';
import type { ApiProjectionReader, IdentityProjection, SyncStatus } from './ports.js';
import type { BindingPort } from './auth/binding.js';
import type { IntentService } from './intents/intents.js';
import type { WorldService } from './world/world-service.js';
import type { AgentConsoleService } from './agents/agent-console.js';

/**
 * E2-03 read-only API.
 *
 * Responses always carry provenance (`source`, `chainId`, `finalizedBlock`,
 * `syncedAt`, `syncState`) so a client can tell confirmed chain facts from
 * stale or unavailable data (docs/ARCHITECTURE.md §7, AGENTS.md §4).
 * Nothing here writes, signs, or upgrades a database flag into chain truth.
 */

export type SessionResolver = (request: FastifyRequest) => Promise<{ appUserId: string } | null>;

export type ApiDeps = {
  readonly chainId: 56 | 97;
  readonly reader: ApiProjectionReader;
  /** null => no RPC configured; identity reads fail closed with RPC_DOWN. */
  readonly chain: ChainReadPort | null;
  /** null/undefined => binding endpoints return NOT_CONFIGURED. */
  readonly binding?: BindingPort | null;
  /** null/undefined => intent endpoints return NOT_CONFIGURED. */
  readonly intents?: IntentService | null;
  /** null/undefined => world endpoints return WORLD_NOT_READY. */
  readonly world?: WorldService | null;
  /** null/undefined => agent console endpoints return NOT_CONFIGURED. */
  readonly agents?: AgentConsoleService | null;
  /** No Web2 auth system exists yet; default resolver denies every request. */
  readonly session?: SessionResolver;
  readonly now?: () => Date;
  /** A cursor older than this is reported as DELAYED. */
  readonly staleAfterSeconds?: number;
  readonly logger?: boolean;
};

const DEFAULT_STALE_AFTER_SECONDS = 300;
/** Reject absurd status filters without echoing unbounded input. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const UINT_DECIMAL_PATTERN = /^\d{1,78}$/;

export function buildApiServer(deps: ApiDeps): FastifyInstance {
  const now = deps.now ?? (() => new Date());
  const staleAfter = deps.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;

  const app = Fastify({
    logger: deps.logger ?? false,
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      const value = Array.isArray(header) ? header[0] : header;
      return value !== undefined && REQUEST_ID_PATTERN.test(value) ? value : randomUUID();
    },
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `route ${request.method} ${request.url} not found`, requestId: request.id },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      reply.status(400).send({
        error: { code: 'INVALID_FILTER', message: 'request validation failed', requestId: request.id },
      });
      return;
    }
    request.log.error({ err: error }, 'unhandled api error');
    reply.status(500).send({
      error: { code: 'INTERNAL', message: 'internal server error', requestId: request.id },
    });
  });

  const syncView = (sync: SyncStatus): Record<string, unknown> => {
    const stale = sync.syncedAt !== null && now().getTime() - sync.syncedAt.getTime() > staleAfter * 1000;
    const state = sync.finalizedBlock === null ? 'UNKNOWN' : stale ? 'DELAYED' : sync.state;
    return {
      state,
      finalizedBlock: sync.finalizedBlock?.toString() ?? null,
      syncedAt: sync.syncedAt?.toISOString() ?? null,
    };
  };

  const db = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'DB_UNAVAILABLE', 'projection database is unavailable');
    }
  };

  const parseId = (raw: string, resource: string): string => {
    if (!UINT_DECIMAL_PATTERN.test(raw)) {
      throw new ApiError(400, 'INVALID_ID', `${resource} id must be a decimal uint256`);
    }
    return raw;
  };

  const asBody = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ApiError(400, 'INVALID_BODY', 'request body must be a JSON object');
    }
    return value as Record<string, unknown>;
  };

  const requireString = (payload: Record<string, unknown>, field: string): string => {
    const value = payload[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ApiError(400, 'INVALID_BODY', `${field} is required`);
    }
    return value;
  };

  const requireAddress = (payload: Record<string, unknown>, field: string): string => {
    const parsed = evmAddressSchema.safeParse(requireString(payload, field));
    if (!parsed.success) {
      throw new ApiError(400, 'INVALID_ADDRESS', `${field} must be a 42-character 0x-prefixed address`);
    }
    return parsed.data;
  };

  const requireHash = (payload: Record<string, unknown>, field: string): string => {
    const value = requireString(payload, field).toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(value)) {
      throw new ApiError(400, 'INVALID_BODY', `${field} must be a 0x-prefixed 32-byte hash`);
    }
    return value;
  };

  const requireUuid = (payload: Record<string, unknown>, field: string): string => {
    const value = requireString(payload, field).toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
      throw new ApiError(400, 'INVALID_BODY', `${field} must be a UUID`);
    }
    return value;
  };

  const requireSession = async (request: FastifyRequest): Promise<{ appUserId: string }> => {
    const session = deps.session === undefined ? null : await deps.session(request);
    if (session === null) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'a Web2 session is required');
    }
    return session;
  };

  const requireBinding = (): BindingPort => {
    const binding = deps.binding;
    if (binding === undefined || binding === null) {
      throw new ApiError(503, 'NOT_CONFIGURED', 'identity binding is not configured');
    }
    return binding;
  };

  const requireIntents = (): IntentService => {
    const intents = deps.intents;
    if (intents === undefined || intents === null) {
      throw new ApiError(503, 'NOT_CONFIGURED', 'action intents are not configured');
    }
    return intents;
  };

  const requireWorld = (): WorldService => {
    const world = deps.world;
    if (world === undefined || world === null) {
      throw new ApiError(503, 'WORLD_NOT_READY', 'the world engine is not configured');
    }
    return world;
  };

  const requireAgents = (): AgentConsoleService => {
    const agents = deps.agents;
    if (agents === undefined || agents === null) {
      throw new ApiError(503, 'NOT_CONFIGURED', 'agent console is not configured');
    }
    return agents;
  };

  const matchesEtag = (header: string | string[] | undefined, etag: string): boolean => {
    if (header === undefined) return false;
    const value = Array.isArray(header) ? header.join(',') : header;
    return value.split(',').some((token) => {
      const normalized = token.trim().replace(/^W\//, '');
      return normalized === etag || normalized === '*';
    });
  };

  app.get('/health/live', async () => ({ status: 'ok', chainId: deps.chainId }));

  app.get('/health/ready', async () => {
    await db(() => deps.reader.ping());
    return {
      status: 'ready',
      db: 'ok',
      chain: deps.chain === null ? 'NOT_CONFIGURED' : 'CONFIGURED',
      chainId: deps.chainId,
    };
  });

  app.get<{ Params: { address: string } }>('/api/v1/identity/:address', async (request) => {
    const parsed = evmAddressSchema.safeParse(request.params.address);
    if (!parsed.success) {
      throw new ApiError(400, 'INVALID_ADDRESS', 'address must be a 42-character 0x-prefixed hex address');
    }
    if (deps.chain === null) {
      throw new ApiError(503, 'RPC_DOWN', 'no BSC RPC endpoint configured; chain identity is unavailable');
    }

    const checkedAt = now().toISOString();
    let state: CitizenChainState;
    try {
      state = await deps.chain.readCitizenState(parsed.data);
    } catch (error) {
      if (error instanceof ChainReadError) {
        throw new ApiError(503, 'RPC_DOWN', 'chain read failed; identity state is unavailable');
      }
      throw error;
    }

    // Projection and sync status are best-effort: the chain read above is the
    // authority, and a database outage must not hide a valid wallet state.
    let projection: IdentityProjection | null = null;
    let sync: SyncStatus = { state: 'UNKNOWN', finalizedBlock: null, syncedAt: null };
    let projectionError: 'DB_UNAVAILABLE' | undefined;
    try {
      [projection, sync] = await Promise.all([
        deps.reader.getIdentityProjection(deps.chainId, parsed.data),
        deps.reader.getSyncStatus(deps.chainId),
      ]);
    } catch {
      projectionError = 'DB_UNAVAILABLE';
    }

    return {
      chainId: deps.chainId,
      source: 'CHAIN_READ',
      checkedAt,
      data: {
        address: parsed.data,
        hasAgentId: state.hasAgentId,
        registered: state.registered,
        build: state.build.toString(),
        rep: state.rep.toString(),
        projection,
        projectionError: projectionError ?? null,
        sync: syncView(sync),
      },
    };
  });

  app.get<{ Querystring: { status?: string } }>('/api/v1/proposals', async (request) => {
    const rawStatus = request.query.status;
    let status: ProposalStatus | undefined;
    if (rawStatus !== undefined) {
      if (!(PROPOSAL_STATUSES as readonly string[]).includes(rawStatus)) {
        throw new ApiError(400, 'INVALID_FILTER', `status must be one of: ${PROPOSAL_STATUSES.join(', ')}`);
      }
      status = rawStatus as ProposalStatus;
    }

    const [proposals, sync] = await db(() =>
      Promise.all([deps.reader.listProposals(status), deps.reader.getSyncStatus(deps.chainId)]),
    );

    return {
      chainId: deps.chainId,
      source: 'CHAIN_CONFIRMED_EVENTS',
      sync: syncView(sync),
      data: proposals.map((proposal) => ({
        chainProposalId: proposal.chainProposalId,
        owner: proposal.owner,
        contentHash: proposal.contentHash,
        deadline: proposal.deadline.toISOString(),
        status: proposal.status,
        createdAt: proposal.createdAt.toISOString(),
        updatedAt: proposal.updatedAt.toISOString(),
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/v1/proposals/:id', async (request) => {
    const id = parseId(request.params.id, 'proposal');

    const [proposal, votes, txLinks, sync] = await db(() =>
      Promise.all([
        deps.reader.findProposal(id),
        deps.reader.getProposalVotes(deps.chainId, id),
        deps.reader.listProposalTxLinks(deps.chainId, id),
        deps.reader.getSyncStatus(deps.chainId),
      ]),
    );
    if (proposal === null) {
      throw new ApiError(404, 'NOT_FOUND', `proposal ${id} not found`);
    }

    return {
      chainId: deps.chainId,
      source: 'CHAIN_CONFIRMED_EVENTS',
      sync: syncView(sync),
      data: {
        chainProposalId: proposal.chainProposalId,
        owner: proposal.owner,
        contentHash: proposal.contentHash,
        deadline: proposal.deadline.toISOString(),
        status: proposal.status,
        votes,
        txLinks,
        createdAt: proposal.createdAt.toISOString(),
        updatedAt: proposal.updatedAt.toISOString(),
      },
    };
  });

  app.get('/api/v1/projects', async () => {
    const [projects, sync] = await db(() =>
      Promise.all([deps.reader.listProjects(), deps.reader.getSyncStatus(deps.chainId)]),
    );

    return {
      chainId: deps.chainId,
      source: 'CHAIN_CONFIRMED_EVENTS',
      sync: syncView(sync),
      data: projects.map((project) => ({
        chainProjectId: project.chainProjectId,
        name: project.name,
        goalBuild: project.goalBuild,
        fundedBuild: project.fundedBuild,
        state: project.state,
        updatedAt: project.updatedAt.toISOString(),
      })),
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/v1/activity', async (request) => {
    const rawLimit = request.query.limit;
    let limit = 50;
    if (rawLimit !== undefined) {
      if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
        throw new ApiError(400, 'INVALID_FILTER', 'limit must be an integer between 1 and 100');
      }
      limit = Number(rawLimit);
    }

    const [activity, sync] = await db(() =>
      Promise.all([
        deps.reader.listActivity(deps.chainId, limit),
        deps.reader.getSyncStatus(deps.chainId),
      ]),
    );

    return {
      chainId: deps.chainId,
      source: 'CHAIN_CONFIRMED_EVENTS',
      sync: syncView(sync),
      data: activity,
    };
  });

  app.get<{ Params: { id: string } }>('/api/v1/projects/:id', async (request) => {
    const id = parseId(request.params.id, 'project');

    const [project, contributors, txLinks, sync] = await db(() =>
      Promise.all([
        deps.reader.findProject(id),
        deps.reader.getProjectContributors(deps.chainId, id),
        deps.reader.listProjectTxLinks(deps.chainId, id),
        deps.reader.getSyncStatus(deps.chainId),
      ]),
    );
    if (project === null) {
      throw new ApiError(404, 'NOT_FOUND', `project ${id} not found`);
    }

    return {
      chainId: deps.chainId,
      source: 'CHAIN_CONFIRMED_EVENTS',
      sync: syncView(sync),
      data: {
        chainProjectId: project.chainProjectId,
        name: project.name,
        goalBuild: project.goalBuild,
        fundedBuild: project.fundedBuild,
        state: project.state,
        contributors,
        txLinks,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
    };
  });

  app.post('/api/v1/auth/binding-challenge', async (request, reply) => {
    const session = await requireSession(request);
    const binding = requireBinding();
    const payload = asBody(request.body);

    const challenge = await binding.createChallenge({
      appUserId: session.appUserId,
      owner: requireAddress(payload, 'owner'),
      agentConfigHash: requireHash(payload, 'agentConfigHash'),
    });

    reply.status(201);
    return challenge;
  });

  app.post('/api/v1/auth/binding-verify', async (request, reply) => {
    const session = await requireSession(request);
    const binding = requireBinding();
    const payload = asBody(request.body);

    const result = await binding.verify({
      appUserId: session.appUserId,
      owner: requireAddress(payload, 'owner'),
      txHash: requireHash(payload, 'txHash'),
      challengeId: requireUuid(payload, 'challengeId'),
    });

    reply.status(result.bindingState === 'BOUND' ? 200 : 202);
    return result;
  });

  app.post('/api/v1/intents', async (request, reply) => {
    const session = await requireSession(request);
    const intents = requireIntents();
    const payload = asBody(request.body);

    const rawHeader = request.headers['idempotency-key'];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const idempotencyKey = intents.validateIdempotencyKey(headerValue ?? '');

    const targetIdRaw = payload.targetId;
    if (targetIdRaw !== undefined && targetIdRaw !== null && typeof targetIdRaw !== 'string') {
      throw new ApiError(400, 'INVALID_BODY', 'targetId must be a string');
    }
    const parametersRaw = payload.parameters ?? {};
    if (typeof parametersRaw !== 'object' || parametersRaw === null || Array.isArray(parametersRaw)) {
      throw new ApiError(400, 'INVALID_BODY', 'parameters must be a JSON object');
    }

    const { intent, created } = await intents.create({
      appUserId: session.appUserId,
      actionType: requireString(payload, 'type'),
      targetId: (targetIdRaw as string | null | undefined) ?? null,
      parameters: parametersRaw as Record<string, unknown>,
      idempotencyKey,
    });

    reply.status(created ? 201 : 200);
    return {
      intentId: intent.id,
      status: intent.status,
      actionType: intent.actionType,
      targetId: intent.targetId,
      createdAt: intent.createdAt.toISOString(),
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/intents/:id/prepare', async (request) => {
    const session = await requireSession(request);
    const intents = requireIntents();
    const intentId = requireUuid({ id: request.params.id }, 'id');

    return intents.prepare({ appUserId: session.appUserId, intentId });
  });

  app.post<{ Params: { id: string } }>('/api/v1/intents/:id/report-submission', async (request) => {
    const session = await requireSession(request);
    const intents = requireIntents();
    const intentId = requireUuid({ id: request.params.id }, 'id');
    const payload = asBody(request.body);

    const result = await intents.reportSubmission({
      appUserId: session.appUserId,
      intentId,
      txHash: requireHash(payload, 'txHash'),
    });

    return {
      ...result,
      note: 'PENDING means the hash was recorded, not confirmed. Status advances only from indexed finalized events.',
    };
  });

  app.get<{ Params: { hash: string } }>('/api/v1/tx/:hash', async (request) => {
    const intents = requireIntents();
    const status = await intents.txStatus(request.params.hash);
    return { chainId: deps.chainId, ...status };
  });

  app.get('/api/v1/my-agent', async (request) => {
    const session = await requireSession(request);
    const agents = requireAgents();
    return {
      source: 'OWNER_CONFIGURED_AGENT',
      data: await agents.getView(session.appUserId),
    };
  });

  app.put('/api/v1/my-agent/config', async (request) => {
    const session = await requireSession(request);
    const agents = requireAgents();
    return agents.updateConfig(session.appUserId, asBody(request.body));
  });

  app.post('/api/v1/my-agent/pause', async (request) => {
    const session = await requireSession(request);
    const agents = requireAgents();
    return agents.setPaused(session.appUserId, asBody(request.body));
  });

  app.get('/api/v1/world', async () => {
    const world = requireWorld();
    return { source: 'WORLD_FRAME_SUMMARY', data: await world.getSummary() };
  });

  app.get('/api/v1/world/frame', async (request, reply) => {
    const world = requireWorld();
    const frame = await world.getFrame();
    const etag = `"${frame.frameId}"`;
    reply.header('etag', etag);
    reply.header('cache-control', 'no-store');
    if (matchesEtag(request.headers['if-none-match'], etag)) {
      reply.status(304);
      return null;
    }
    return frame;
  });

  app.get('/api/v1/world/scene-manifest', async (request, reply) => {
    let manifest;
    try {
      manifest = getSceneManifest();
    } catch (error) {
      if (error instanceof SceneManifestError) {
        throw new ApiError(404, 'SCENE_NOT_FOUND', 'the published scene manifest is unavailable');
      }
      throw error;
    }

    const etag = `"${manifest.manifestHash}"`;
    reply.header('etag', etag);
    reply.header('cache-control', 'public, max-age=300');
    if (matchesEtag(request.headers['if-none-match'], etag)) {
      reply.status(304);
      return null;
    }
    return manifest;
  });

  app.get<{ Querystring: { once?: string } }>('/api/v1/world/stream', async (request, reply) => {
    const world = requireWorld();
    // Fail before hijacking so a closed stream never hides a 503.
    const frame = await world.getFrame();

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const send = (event: string, data: unknown): void => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    raw.write('retry: 5000\n\n');
    send('world.frame', {
      frameId: frame.frameId,
      tick: frame.simulation.tick,
      generatedAt: frame.generatedAt,
    });

    if (request.query.once === '1') {
      raw.end();
      return;
    }

    const heartbeat = setInterval(() => {
      send('world.heartbeat', { at: new Date().toISOString() });
    }, 15_000);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      raw.end();
    });
  });

  return app;
}
