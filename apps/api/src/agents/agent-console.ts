import { GOALS, PERSONAS, evmAddressSchema } from '@agent-republic/domain';
import type { Goal, Persona } from '@agent-republic/domain';
import { ApiError } from '../errors.js';

/**
 * E3-07 — owner-protected agent console.
 *
 * The owner always comes from the verified Web2 binding, never from the HTTP
 * body. Every config save creates an immutable version row; pause/resume also
 * records a version so old records remain queryable. No keys, prompts or
 * wallet secrets are accepted here.
 */

export type AgentStatus = 'ACTIVE' | 'PAUSED';

export type AgentConfigVersionView = {
  readonly version: number;
  readonly name: string;
  readonly persona: Persona;
  readonly goal: Goal;
  readonly paused: boolean;
  readonly createdAt: string;
};

export type AgentActionView = {
  readonly id: string;
  readonly actionType: string;
  readonly status: string;
  readonly targetId: string | null;
  readonly txHash: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AgentConsoleView = {
  readonly agentId: string;
  readonly owner: string;
  readonly name: string;
  readonly persona: Persona;
  readonly goal: Goal;
  readonly status: AgentStatus;
  readonly configVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: AgentConfigVersionView[];
  readonly recentActions: AgentActionView[];
};

export type AgentConfigInput = {
  readonly name: string;
  readonly persona: Persona;
  readonly goal: Goal;
  readonly expectedVersion: number | null;
};

export type AgentConfigSaveResult = {
  readonly agentId: string;
  readonly configVersion: number;
  readonly status: AgentStatus;
};

export class AgentVersionConflictError extends Error {
  constructor(message = 'agent config version conflict') {
    super(message);
    this.name = 'AgentVersionConflictError';
  }
}

export interface AgentConsoleRepository {
  findOwnerForAppUser(appUserId: string): Promise<string | null>;
  getByOwner(owner: string): Promise<AgentConsoleView | null>;
  saveConfig(input: {
    owner: string;
    name: string;
    persona: Persona;
    goal: Goal;
    expectedVersion: number | null;
  }): Promise<AgentConfigSaveResult>;
  setPaused(owner: string, paused: boolean): Promise<AgentConfigSaveResult | null>;
}

const CONFIG_KEYS = new Set(['name', 'persona', 'goal', 'expectedVersion']);
const PAUSE_KEYS = new Set(['paused']);

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_BODY', 'request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function rejectOwnerField(record: Record<string, unknown>): void {
  if ('owner' in record) {
    throw new ApiError(
      400,
      'OWNER_NOT_ALLOWED',
      'owner is derived from the verified session binding and cannot be supplied here',
    );
  }
}

function unicodeLength(value: string): number {
  return [...value].length;
}

function parseConfigInput(body: unknown): AgentConfigInput {
  const record = asRecord(body);
  rejectOwnerField(record);
  for (const key of Object.keys(record)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new ApiError(400, 'INVALID_BODY', `unknown field "${key}"`);
    }
  }

  const name = record.name;
  if (typeof name !== 'string' || unicodeLength(name.trim()) === 0 || unicodeLength(name) > 64) {
    throw new ApiError(400, 'INVALID_BODY', 'name must be 1..64 characters');
  }
  if (!(PERSONAS as readonly string[]).includes(String(record.persona))) {
    throw new ApiError(400, 'INVALID_BODY', 'persona is not supported');
  }
  if (!(GOALS as readonly string[]).includes(String(record.goal))) {
    throw new ApiError(400, 'INVALID_BODY', 'goal is not supported');
  }
  let expectedVersion: number | null = null;
  if (record.expectedVersion !== undefined) {
    if (
      typeof record.expectedVersion !== 'number' ||
      !Number.isInteger(record.expectedVersion) ||
      record.expectedVersion < 1
    ) {
      throw new ApiError(400, 'INVALID_BODY', 'expectedVersion must be a positive integer');
    }
    expectedVersion = record.expectedVersion;
  }

  return {
    name: name.trim(),
    persona: record.persona as Persona,
    goal: record.goal as Goal,
    expectedVersion,
  };
}

function parsePauseInput(body: unknown): boolean {
  const record = asRecord(body);
  rejectOwnerField(record);
  for (const key of Object.keys(record)) {
    if (!PAUSE_KEYS.has(key)) {
      throw new ApiError(400, 'INVALID_BODY', `unknown field "${key}"`);
    }
  }
  if (typeof record.paused !== 'boolean') {
    throw new ApiError(400, 'INVALID_BODY', 'paused must be a boolean');
  }
  return record.paused;
}

export class AgentConsoleService {
  private readonly repo: AgentConsoleRepository;

  constructor(repo: AgentConsoleRepository) {
    this.repo = repo;
  }

  private async requireOwner(appUserId: string): Promise<string> {
    const owner = await this.repo.findOwnerForAppUser(appUserId);
    if (owner === null) {
      throw new ApiError(403, 'BINDING_REQUIRED', 'a confirmed Agent ID binding is required');
    }
    return evmAddressSchema.parse(owner);
  }

  async getView(appUserId: string): Promise<AgentConsoleView> {
    const owner = await this.requireOwner(appUserId);
    const view = await this.repo.getByOwner(owner);
    if (view === null) {
      throw new ApiError(404, 'NO_AGENT', 'no agent is configured for this owner');
    }
    return view;
  }

  async updateConfig(appUserId: string, body: unknown): Promise<AgentConfigSaveResult> {
    const owner = await this.requireOwner(appUserId);
    const input = parseConfigInput(body);
    try {
      return await this.repo.saveConfig({ owner, ...input });
    } catch (error) {
      if (error instanceof AgentVersionConflictError) {
        throw new ApiError(
          409,
          'VERSION_CONFLICT',
          'agent config was changed by another request; reload before saving',
        );
      }
      throw error;
    }
  }

  async setPaused(appUserId: string, body: unknown): Promise<AgentConfigSaveResult> {
    const owner = await this.requireOwner(appUserId);
    const paused = parsePauseInput(body);
    const result = await this.repo.setPaused(owner, paused);
    if (result === null) {
      throw new ApiError(404, 'NO_AGENT', 'no agent is configured for this owner');
    }
    return result;
  }
}
