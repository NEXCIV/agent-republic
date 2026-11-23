import { commandRequestSchema, PERSONAS, type Persona, type CommandRecord, type CommandRequest } from '@agent-republic/domain';
import {
  advanceCommandRecord, AgentObservationError, buildAgentObservation, planCommand, type CommandContext,
  buildCommandPlanPrompt, parseCommandModelPlan, buildCommandReplyPrompt, parseCommandModelReply,
} from '@agent-republic/agent-engine';
import type { CommandIdentityReader } from '@agent-republic/chain';
import { ApiError } from '../errors.js';
import type { WorldService } from '../world/world-service.js';
import type { AgentConsoleService, AgentConsoleView } from './agent-console.js';
import type { CommandStore } from './command-store.js';
import type { LocalCommandModel } from './command-model.js';

type VerifiedContext = CommandContext & { sourceBlockHash?: string };
type Observe = (agent: AgentConsoleView) => Promise<VerifiedContext>;

export async function readCommandContext(
  agent: AgentConsoleView, world: Pick<WorldService, 'getFrame'>, chain: Pick<CommandIdentityReader, 'readCommandIdentity'> | null,
): Promise<VerifiedContext> {
  if (!chain) throw new ApiError(503, 'RPC_DOWN', 'Agent ID verification is unavailable.');
  const frame = await world.getFrame();
  if (frame.source.sync !== 'LIVE') throw new ApiError(503, 'WORLD_NOT_READY', 'World sync is delayed.');
  const identity = await chain.readCommandIdentity(agent.owner, BigInt(frame.source.blockNumber)).catch(() => {
    throw new ApiError(503, 'RPC_DOWN', 'Agent ID verification is unavailable.');
  });
  // Verify the snapshot before treating a negative identity result as a permanent loss of rights.
  if (identity.blockHash !== frame.source.blockHash) {
    throw new ApiError(503, 'WORLD_NOT_READY', 'The observed block changed. Waiting for the indexer.');
  }
  if (identity.networkBlockNumber - BigInt(frame.source.blockNumber) < BigInt(frame.source.confirmedDepth)) {
    throw new ApiError(503, 'WORLD_NOT_READY', 'The observed block lacks the configured confirmation depth.');
  }
  if (!identity.eligibleNow || !identity.registered || !identity.hasAgentId) {
    throw new ApiError(403, 'BINDING_REQUIRED', 'Commands require a registered, current Agent ID holder.');
  }
  try {
    const observation = buildAgentObservation(frame, {
      owner: agent.owner, blockNumber: frame.source.blockNumber, blockHash: identity.blockHash,
      hasAgentId: identity.hasAgentId, registered: identity.registered,
      build: identity.build.toString(), rep: identity.rep.toString(),
    }, { networkBlockNumber: identity.networkBlockNumber.toString() });
    const peers = frame.society.agentSummaries.flatMap((peer) =>
      PERSONAS.includes(peer.persona as Persona) && peer.agentId !== agent.agentId
        ? [{ agentId: peer.agentId, displayName: peer.displayName, persona: peer.persona as Persona, active: peer.active }]
        : [],
    );
    return { observation, profile: { agentId: agent.agentId, persona: agent.persona, goal: agent.goal }, peers, sourceBlockHash: identity.blockHash };
  } catch (error) {
    if (error instanceof AgentObservationError) throw new ApiError(503, 'WORLD_NOT_READY', 'A fresh, verified observation is required.');
    throw error;
  }
}

export class CommandService {
  private readonly submissions = new Map<string, { request: CommandRequest; saved: Promise<CommandRecord> }>();
  constructor(
    private readonly agents: Pick<AgentConsoleService, 'getView'>,
    private readonly store: CommandStore,
    private readonly observe: Observe,
    private readonly model?: Pick<LocalCommandModel, 'complete'>,
    private readonly canonicalHash?: (block: bigint) => Promise<string>,
  ) {}

  async list(appUserId: string): Promise<CommandRecord[]> {
    const { owner, agentId, configVersion } = await this.agents.getView(appUserId);
    return this.store.list({ appUserId, owner, agentId, configVersion });
  }

  async submit(appUserId: string, body: unknown): Promise<CommandRecord> {
    const parsed = commandRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, 'INVALID_BODY', 'Supply a request ID, a mode and a command of 1–500 characters. Keep credentials out of commands.');
    const request = parsed.data;
    const key = appUserId + ':' + request.requestId;
    const pending = this.submissions.get(key);
    if (pending) {
      this.checkReplay(pending.request, request);
      return pending.saved;
    }
    const saved = this.save(appUserId, request).finally(() => this.submissions.delete(key));
    this.submissions.set(key, { request, saved });
    return saved;
  }

  private checkReplay(original: CommandRequest, request: CommandRequest) {
    if (original.text !== request.text || original.mode !== request.mode) {
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This request ID was already used for another command.');
    }
  }

  private async save(appUserId: string, request: CommandRequest) {
    const agent = await this.agents.getView(appUserId);
    const { owner, agentId, configVersion } = agent;
    const scope = { appUserId, owner, agentId, configVersion };
    const previous = await this.store.findRequest(scope, request.requestId);
    if (previous) {
      this.checkReplay(previous, request);
      return previous;
    }
    if (agent.status !== 'ACTIVE') throw new ApiError(409, 'VERSION_CONFLICT', 'Resume your agent before sending a command.');
    const context = await this.observe(agent);
    const prompt = this.model && buildCommandPlanPrompt(request, context);
    const candidate = prompt && await this.model?.complete({
      agentId, requestKey: request.requestId, kind: 'MAIN_DECISION',
    }, prompt);
    const plan = candidate ? parseCommandModelPlan(candidate, request, context) : planCommand(request, context);
    const { sourceBlock, worldFrameId } = context.observation;
    return this.store.submit(scope, { request, plan, sourceBlock, worldFrameId, sourceBlockHash: context.sourceBlockHash });
  }

  /** No browser needs to remain connected. Leases and revisions coordinate API replicas. */
  async dispatch(onError: (error: unknown) => void): Promise<void> {
    const pending = await this.store.pending(8);
    await Promise.all(pending.map(async ({ scope, commandId, expectedRevision, sourceBlock, sourceBlockHash }) => {
      try {
        const agent = await this.agents.getView(scope.appUserId);
        if (agent.status !== 'ACTIVE' || agent.agentId !== scope.agentId ||
            agent.configVersion !== scope.configVersion || agent.owner !== scope.owner) return;
        const context = await this.observe(agent);
        if (sourceBlock && sourceBlockHash) {
          const observed = BigInt(context.observation.sourceBlock);
          if (observed < BigInt(sourceBlock)) return;
          const hash = observed === BigInt(sourceBlock) ? context.sourceBlockHash : await this.canonicalHash?.(BigInt(sourceBlock));
          if (!hash) return;
          if (hash !== sourceBlockHash) {
            await this.store.advance(scope, { commandId, expectedRevision }, (record) => ({
              ...record, status: 'FAILED', report: 'The observed block was reorganized. Submit a new command for a fresh report.',
            }));
            return;
          }
        }
        let reply: { result: string; failed: boolean } | undefined;
        if (this.model) {
          const record = (await this.store.list(scope)).find((entry) => entry.id === commandId && entry.revision === expectedRevision);
          const step = record?.steps[record.results.length];
          if (record && step?.kind === 'DISCUSS') {
            const prompt = buildCommandReplyPrompt(step, context, record.text);
            if (prompt) {
              const raw = await this.model.complete({
                agentId: step.targetAgentId, requestKey: commandId + ':' + record.results.length, kind: 'DEBATE_REPLY',
              }, prompt);
              if (raw) reply = parseCommandModelReply(raw, step, context);
            }
          }
        }
        await this.store.advance(scope, { commandId, expectedRevision },
          (record) => ({ ...advanceCommandRecord(record, context, new Date().toISOString(), reply), sourceBlockHash: context.sourceBlockHash }));
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 403) {
          await this.store.advance(scope, { commandId, expectedRevision },
            (record) => ({ ...record, status: 'FAILED', report: 'Owner eligibility could not be confirmed.' }))
            .catch(onError);
        } else if (!(error instanceof ApiError && error.statusCode === 409)) {
          onError(error);
        }
      }
    }));
  }
}
