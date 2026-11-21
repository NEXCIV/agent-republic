import {
  SCENE_VERSION,
  type WorldFrameV1,
  type WorldSimulation,
  type WorldSociety,
} from '@agent-republic/domain';
import {
  buildWorldFrame,
  reduceFacts,
  WorldFrameBuildError,
} from '@agent-republic/world-engine';
import { ApiError } from '../errors.js';
import type { WorldRawData, WorldReader } from './world-reader.js';

/**
 * E5-06 world service: raw confirmed data → validated WorldFrameV1.
 *
 * Never serves a frame it cannot fully validate. Missing indexer progress,
 * missing simulation state or schema violations all fail with
 * WORLD_NOT_READY instead of placeholder content.
 */

export type WorldServiceDeps = {
  readonly reader: WorldReader;
  readonly chainId: 56 | 97;
  readonly confirmedDepth: number;
  readonly sceneVersion?: string;
  readonly worldSeedFallback?: string;
  readonly now?: () => Date;
  /** Cursor age after which sync is reported as DELAYED. */
  readonly staleAfterSeconds?: number;
};

export type WorldSummary = {
  readonly chainId: 56 | 97;
  readonly frameId: string;
  readonly epochId: number;
  readonly sync: string;
  readonly citizenCount: number;
  readonly projectCount: number;
  readonly proposalCount: number;
  readonly tick: string;
  readonly generatedAt: string;
};

type ParsedSimState = {
  readonly worldSeed: string;
  readonly agents: WorldSimulation['agents'];
};

const DEFAULT_STALE_AFTER_SECONDS = 300;

export class WorldService {
  private readonly deps: WorldServiceDeps;
  private readonly sceneVersion: string;
  private readonly now: () => Date;

  constructor(deps: WorldServiceDeps) {
    this.deps = deps;
    this.sceneVersion = deps.sceneVersion ?? SCENE_VERSION;
    this.now = deps.now ?? (() => new Date());
  }

  async getFrame(): Promise<WorldFrameV1> {
    const raw = await this.deps.reader.loadRaw(this.deps.chainId, this.sceneVersion);
    return this.assemble(raw);
  }

  async getSummary(): Promise<WorldSummary> {
    const frame = await this.getFrame();
    return {
      chainId: frame.source.chainId,
      frameId: frame.frameId,
      epochId: frame.epochId,
      sync: frame.source.sync,
      citizenCount: frame.facts.citizenCount,
      projectCount: frame.facts.projects.length,
      proposalCount: frame.facts.proposals.length,
      tick: frame.simulation.tick,
      generatedAt: frame.generatedAt,
    };
  }

  private assemble(raw: WorldRawData): WorldFrameV1 {
    if (raw.cursor === null || raw.block === null) {
      throw new ApiError(503, 'WORLD_NOT_READY', 'the indexer has not finalized a block yet');
    }
    if (raw.tick === null) {
      throw new ApiError(503, 'WORLD_NOT_READY', 'no world tick has been produced yet');
    }

    const state = this.parseSimState(raw.tick.stateJson);
    if (state === null) {
      throw new ApiError(503, 'WORLD_NOT_READY', 'stored simulation state is missing or malformed');
    }

    const staleAfter = (this.deps.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS) * 1000;
    // A pending reorg rollback outranks staleness: the client must know that
    // previously shown milestones are being withdrawn.
    const sync = raw.pendingRecovery
      ? 'REORG_RECOVERY'
      : this.now().getTime() - raw.cursor.updatedAt.getTime() > staleAfter
        ? 'DELAYED'
        : 'LIVE';

    const society: WorldSociety = {
      socialRevision: raw.society.socialRevision,
      publicMessages: raw.society.messages.map((message) => ({
        id: message.id,
        agentId: message.agentId,
        owner: message.owner,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
        moderation: 'APPROVED' as const,
        provenance: 'AI_SIMULATED' as const,
      })),
      agentSummaries: raw.society.agents.map((agent) => ({
        agentId: agent.agentId,
        owner: agent.owner,
        displayName: agent.displayName,
        persona: agent.persona,
        active: agent.active,
      })),
    };

    const simulation: WorldSimulation = {
      tick: raw.tick.tick,
      worldSeed: state.worldSeed,
      sceneVersion: SCENE_VERSION,
      agents: state.agents,
      visualEvents: raw.visualEvents.map((event) => ({
        id: event.id,
        kind: event.kind as WorldSimulation['visualEvents'][number]['kind'],
        targetId: event.targetId,
        happenedAtTick: event.happenedAtTick,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
      })),
    };

    try {
      return buildWorldFrame({
        source: {
          chainId: this.deps.chainId,
          blockNumber: raw.block.number,
          blockHash: raw.block.hash,
          blockTimestamp: raw.block.timestamp.toISOString(),
          confirmedDepth: this.deps.confirmedDepth,
          sync,
        },
        facts: reduceFacts(raw.events),
        society,
        simulation,
        generatedAt: this.now().toISOString(),
      });
    } catch (error) {
      if (error instanceof WorldFrameBuildError) {
        throw new ApiError(
          503,
          'WORLD_NOT_READY',
          'stored world state cannot form a valid frame; a rebuild is required',
        );
      }
      throw error;
    }
  }

  private parseSimState(value: unknown): ParsedSimState | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const seed =
      typeof record.worldSeed === 'string' && record.worldSeed !== ''
        ? record.worldSeed
        : this.deps.worldSeedFallback;
    if (seed === undefined || seed === '') return null;
    if (!Array.isArray(record.agents)) return null;
    return { worldSeed: seed, agents: record.agents as WorldSimulation['agents'] };
  }
}
