import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { AGENT_DAILY_LIMITS, makeCommandRecord, withCommandOrigin, type CommandPlan } from '@agent-republic/agent-engine';
import {
  commandRecordSchema, type AgentLocation, type CommandRecord, type CommandRequest,
} from '@agent-republic/domain';
import { ApiError } from '../errors.js';

export type CommandScope = {
  appUserId: string;
  owner: string;
  agentId: string;
  configVersion: number;
};

export type CommandSubmission = {
  request: CommandRequest;
  plan: CommandPlan;
  sourceBlock: string;
  sourceBlockHash?: string;
  worldFrameId: string;
};

export type CommandTicket = { commandId: string; expectedRevision: number };
export type PendingCommand = CommandTicket & { scope: CommandScope; sourceBlock?: string; sourceBlockHash?: string | null };
export type ModelCallReservation = {
  agentId: string;
  requestKey: string;
  kind: 'MAIN_DECISION' | 'DEBATE_REPLY';
  model: string;
  maxDailyCalls: number;
};

export interface CommandStore {
  list(scope: CommandScope): Promise<CommandRecord[]>;
  findRequest(scope: CommandScope, requestId: string): Promise<CommandRecord | null>;
  submit(scope: CommandScope, input: CommandSubmission): Promise<CommandRecord>;
  advance(scope: CommandScope, ticket: CommandTicket, step: (record: CommandRecord) => CommandRecord): Promise<CommandRecord>;
  pending(limit: number): Promise<PendingCommand[]>;
  reserveModelCall(input: ModelCallReservation): Promise<boolean>;
}

const commandColumns = `
  id, request_id AS "requestId", command_text AS text, mode, status, steps, results, report,
  source_block::text AS "sourceBlock", source_block_hash AS "sourceBlockHash",
  world_frame_id AS "worldFrameId", config_version AS "configVersion",
  revision, created_at AS "createdAt", updated_at AS "updatedAt"`;

type CommandRow = Omit<CommandRecord, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };

function parseRow(row: CommandRow): CommandRecord {
  return commandRecordSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
}

async function readRequest(client: PoolClient, scope: CommandScope, requestId: string): Promise<CommandRecord | null> {
  const previous = await client.query<CommandRow>(
    `SELECT ${commandColumns} FROM agent_commands
      WHERE agent_id = $1 AND app_user_id = $2 AND request_id = $3`,
    [scope.agentId, scope.appUserId, requestId],
  );
  return previous.rows[0] ? parseRow(previous.rows[0]) : null;
}

async function currentLocation(client: PoolClient, scope: CommandScope): Promise<AgentLocation> {
  const location = await client.query<{ location: AgentLocation }>(
    'SELECT location FROM agent_command_locations WHERE agent_id = $1 AND app_user_id = $2',
    [scope.agentId, scope.appUserId],
  );
  return location.rows[0]?.location ?? 'PLAZA';
}

async function resumeInterrupted(client: PoolClient, scope: CommandScope, location: AgentLocation): Promise<void> {
  const interrupted = await client.query<CommandRow>(
    `SELECT ${commandColumns} FROM agent_commands WHERE agent_id = $1 AND app_user_id = $2
       AND config_version = $3 AND status = 'PAUSED' ORDER BY seq DESC LIMIT 1`,
    [scope.agentId, scope.appUserId, scope.configVersion],
  );
  if (!interrupted.rows[0]) return;
  const resumed = withCommandOrigin(parseRow(interrupted.rows[0]), location);
  await client.query(
    `UPDATE agent_commands SET status = 'RUNNING', steps = $2, revision = revision + 1,
            updated_at = clock_timestamp(), next_attempt_at = clock_timestamp() WHERE id = $1`,
    [resumed.id, JSON.stringify(resumed.steps)],
  );
}

export class PgCommandStore implements CommandStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    if (!connectionString.trim()) throw new Error('A database connection is required for private agent commands.');
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private withAgent<T>(scope: CommandScope, write: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      const result = await client.query<{ status: string; config_version: number }>(
        `SELECT a.status, a.config_version FROM agents a
           JOIN identity_bindings b ON b.owner = a.owner
          WHERE a.id = $1 AND a.owner = $2 AND b.app_user_id = $3
          FOR SHARE OF b FOR ${write ? 'UPDATE' : 'SHARE'} OF a`,
        [scope.agentId, scope.owner, scope.appUserId],
      );
      const agent = result.rows[0];
      if (!agent) throw new ApiError(403, 'BINDING_REQUIRED', 'An active owner binding to this agent is required.');
      if (write && (agent.status !== 'ACTIVE' || agent.config_version !== scope.configVersion)) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'The agent was paused or reconfigured. Reload its console.');
      }
      return work(client);
    });
  }

  async list(scope: CommandScope): Promise<CommandRecord[]> {
    return this.withAgent(scope, false, async (client) => {
      const rows = await client.query<CommandRow>(
        `SELECT ${commandColumns} FROM agent_commands WHERE agent_id = $1 AND app_user_id = $2
          ORDER BY (status = 'RUNNING') DESC, (status = 'PAUSED') DESC, seq DESC LIMIT 30`,
        [scope.agentId, scope.appUserId],
      );
      return rows.rows.map(parseRow);
    });
  }

  findRequest(scope: CommandScope, requestId: string): Promise<CommandRecord | null> {
    return this.withAgent(scope, false, (client) => readRequest(client, scope, requestId));
  }

  async submit(scope: CommandScope, input: CommandSubmission): Promise<CommandRecord> {
    return this.withAgent(scope, true, async (client) => {
      const { request } = input;
      const previous = await readRequest(client, scope, request.requestId);
      if (previous) {
        if (request.text !== previous.text || request.mode !== previous.mode) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This request ID was used for a different command.');
        }
        return previous;
      }

      const prepared = makeCommandRecord(request, input.plan, {
        id: randomUUID(), configVersion: scope.configVersion, sourceBlock: input.sourceBlock,
        worldFrameId: input.worldFrameId, now: new Date().toISOString(),
      });
      const record = withCommandOrigin(
        commandRecordSchema.parse({ ...prepared, sourceBlockHash: input.sourceBlockHash ?? null }),
        await currentLocation(client, scope),
      );
      if (record.status === 'RUNNING') {
        const outstanding = await client.query<{ status: string }>(
          `SELECT status FROM agent_commands WHERE agent_id = $1 AND app_user_id = $2
            AND status IN ('RUNNING', 'PAUSED')`, [scope.agentId, scope.appUserId],
        );
        if (outstanding.rows.length >= 8) {
          throw new ApiError(409, 'COMMAND_BUSY', 'Finish the current interrupts before sending another command.');
        }
        if (outstanding.rows.some((row) => row.status === 'RUNNING')) {
          if (record.mode !== 'INTERRUPT') {
            throw new ApiError(409, 'COMMAND_BUSY', 'The agent already has a task. Choose interrupt or wait for it to finish.');
          }
          await client.query(
            `UPDATE agent_commands SET status = 'PAUSED', revision = revision + 1, updated_at = clock_timestamp()
              WHERE agent_id = $1 AND app_user_id = $2 AND status = 'RUNNING'`, [scope.agentId, scope.appUserId],
          );
        }
      }
      await client.query(
        `INSERT INTO agent_commands
          (id, agent_id, app_user_id, config_version, request_id, command_text, mode, status,
           steps, results, report, source_block, world_frame_id, revision, created_at, updated_at, source_block_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16)`,
        [record.id, scope.agentId, scope.appUserId, record.configVersion, record.requestId, record.text,
         record.mode, record.status, JSON.stringify(record.steps), JSON.stringify(record.results), record.report,
         record.sourceBlock, record.worldFrameId, record.revision, record.createdAt, record.sourceBlockHash ?? null],
      );
      return record;
    });
  }

  async advance(scope: CommandScope, ticket: CommandTicket, step: (record: CommandRecord) => CommandRecord): Promise<CommandRecord> {
    return this.withAgent(scope, true, async (client) => {
      const current = await client.query<CommandRow>(
        `SELECT ${commandColumns} FROM agent_commands WHERE agent_id = $1 AND app_user_id = $2 AND id = $3`,
        [scope.agentId, scope.appUserId, ticket.commandId],
      );
      const row = current.rows[0];
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Command not found.');
      let location = await currentLocation(client, scope);
      const record = withCommandOrigin(parseRow(row), location);
      if (record.status !== 'RUNNING' || record.configVersion !== scope.configVersion || record.revision !== ticket.expectedRevision) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'The command was already advanced or interrupted.');
      }
      const next = commandRecordSchema.parse(step(record));
      const currentStep = record.steps[record.results.length];
      if (currentStep?.kind === 'DISCUSS' && next.status !== 'FAILED') {
        const recipient = await client.query(
          "SELECT 1 FROM agents WHERE id::text = $1 AND status = 'ACTIVE'",
          [currentStep.targetAgentId],
        );
        if (recipient.rowCount !== 1) {
          next.status = 'FAILED';
          next.report = 'The recipient is unavailable.';
          next.results = [...record.results, next.report];
        }
      }
      if (currentStep?.kind === 'VISIT' && next.status !== 'FAILED' && next.results.length > record.results.length) {
        location = currentStep.location;
        await client.query(
          `INSERT INTO agent_command_locations (agent_id, app_user_id, location) VALUES ($1,$2,$3)
            ON CONFLICT (agent_id, app_user_id) DO UPDATE SET location = excluded.location`,
          [scope.agentId, scope.appUserId, location],
        );
      }
      const updated = await client.query<CommandRow>(
        `UPDATE agent_commands SET status = $2, results = $3, report = $4, revision = revision + 1,
                source_block = $5, world_frame_id = $6, source_block_hash = $7, steps = $8,
                updated_at = clock_timestamp(), next_attempt_at = clock_timestamp()
          WHERE id = $1 RETURNING ${commandColumns}`,
        [record.id, next.status, JSON.stringify(next.results), next.report, next.sourceBlock, next.worldFrameId,
         next.sourceBlockHash ?? null, JSON.stringify(record.steps)],
      );
      if (next.status === 'COMPLETED' || next.status === 'FAILED') {
        await resumeInterrupted(client, scope, location);
      }
      return parseRow(updated.rows[0]!);
    });
  }

  async pending(limit: number): Promise<PendingCommand[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Expected a batch of 1–100 commands.');
    // A short lease rotates unavailable owners behind other eligible work. If a
    // process dies before advancing the revision, another instance can claim it.
    const result = await this.pool.query<{
      owner: string; agent_id: string; app_user_id: string; config_version: number; id: string; revision: number;
      source_block: string; source_block_hash: string | null;
    }>(
      `WITH due AS (
         SELECT c.seq, a.owner FROM agent_commands c
           JOIN agents a ON a.id = c.agent_id AND a.config_version = c.config_version AND a.status = 'ACTIVE'
           JOIN identity_bindings b ON b.owner = a.owner AND b.app_user_id = c.app_user_id
          WHERE c.status = 'RUNNING' AND c.next_attempt_at <= clock_timestamp()
          ORDER BY c.next_attempt_at, c.seq LIMIT $1 FOR UPDATE OF c SKIP LOCKED
       )
       UPDATE agent_commands c SET next_attempt_at = clock_timestamp() + interval '15 seconds'
         FROM due WHERE c.seq = due.seq
         RETURNING due.owner, c.agent_id, c.app_user_id, c.config_version, c.id, c.revision,
                   c.source_block::text, c.source_block_hash`, [limit],
    );
    return result.rows.map((row) => ({
      scope: { owner: row.owner, appUserId: row.app_user_id, agentId: row.agent_id, configVersion: row.config_version },
      commandId: row.id, expectedRevision: row.revision,
      ...(row.source_block_hash ? { sourceBlock: row.source_block, sourceBlockHash: row.source_block_hash } : {}),
    }));
  }

  async reserveModelCall(input: ModelCallReservation): Promise<boolean> {
    const { agentId, requestKey, kind, model, maxDailyCalls } = input;
    if (!requestKey.trim() || !model.trim() || !Number.isSafeInteger(maxDailyCalls) || maxDailyCalls <= 0) {
      return false;
    }
    const requestId = `command:${agentId}:${kind}:${requestKey}`;
    return this.transaction(async (client) => {
      // Take the platform-wide lock in a separate statement. The following
      // READ COMMITTED snapshot must see reservations committed by other hosts.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('civrum.local-model-budget'))");
      const admission = await client.query(
        `WITH actor AS (
           SELECT id FROM agents WHERE id = $1 AND status = 'ACTIVE' FOR SHARE
         ), usage_today AS (
           SELECT count(*) FILTER (WHERE provider = 'ollama-local') AS platform_calls,
                  count(*) FILTER (WHERE agent_id = $1 AND call_kind = $2) AS actor_calls
             FROM llm_usage
            WHERE call_kind IS NOT NULL
              AND created_at >= date_trunc('day', statement_timestamp(), 'UTC')
         )
         INSERT INTO llm_usage (agent_id, request_id, provider, model, call_kind, status, created_at)
         SELECT actor.id, $3, 'ollama-local', $4, $2, 'RESERVED', statement_timestamp()
           FROM actor CROSS JOIN usage_today
          WHERE usage_today.platform_calls < $5 AND usage_today.actor_calls < $6
         ON CONFLICT (request_id) DO NOTHING`,
        [agentId, kind, requestId, model, maxDailyCalls, AGENT_DAILY_LIMITS[kind].calls],
      );
      return admission.rowCount === 1;
    });
  }
}
