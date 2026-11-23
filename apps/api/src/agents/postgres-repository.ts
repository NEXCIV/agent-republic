import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type {
  AgentActionView,
  AgentConfigSaveResult,
  AgentConfigVersionView,
  AgentConsoleRepository,
  AgentConsoleView,
  AgentStatus,
} from './agent-console.js';
import { AgentVersionConflictError } from './agent-console.js';
import type { Goal, Persona } from '@agent-republic/domain';

/**
 * E3-07 PostgreSQL agent console repository.
 *
 * Owner is always part of the WHERE clause. Config writes run in a transaction
 * with SELECT ... FOR UPDATE, append an immutable agent_configs version and
 * bump agents.config_version. Old versions are never rewritten.
 */

type AgentRow = {
  id: string;
  owner: string;
  name: string;
  persona: Persona;
  goal: Goal;
  status: AgentStatus;
  config_version: number;
  created_at: Date;
  updated_at: Date;
};

type ConfigRow = {
  version: number;
  config_json_encrypted: Buffer;
  created_at: Date;
};

type ActionRow = {
  id: string;
  action_type: string;
  status: string;
  target_id: string | null;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
};

type StoredConfig = {
  name: string;
  persona: Persona;
  goal: Goal;
  paused: boolean;
};

function configSnapshot(name: string, persona: Persona, goal: Goal, paused: boolean): StoredConfig {
  return { name, persona, goal, paused };
}

function encodeConfig(config: StoredConfig): { bytes: Buffer; hash: string } {
  const bytes = Buffer.from(JSON.stringify(config), 'utf8');
  const hash = `0x${createHash('sha256').update(bytes).digest('hex')}`;
  return { bytes, hash };
}

function decodeConfig(row: ConfigRow): AgentConfigVersionView {
  const parsed = JSON.parse(row.config_json_encrypted.toString('utf8')) as StoredConfig;
  return {
    version: row.version,
    name: parsed.name,
    persona: parsed.persona,
    goal: parsed.goal,
    paused: parsed.paused,
    createdAt: row.created_at.toISOString(),
  };
}

async function endCommandsForConfig(client: PoolClient, agentId: string, version: number): Promise<void> {
  await client.query(
    `UPDATE agent_commands
        SET status = 'FAILED', report = 'The agent configuration changed before this task finished.',
            revision = revision + 1, updated_at = clock_timestamp()
      WHERE agent_id = $1 AND config_version = $2 AND status IN ('RUNNING', 'PAUSED')`,
    [agentId, version],
  );
}

export class PostgresAgentConsoleRepository implements AgentConsoleRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    if (connectionString.trim() === '') {
      throw new Error('[api] DATABASE_URL is required; refusing to start without a database');
    }
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async findOwnerForAppUser(appUserId: string): Promise<string | null> {
    const result = await this.pool.query<{ owner: string }>(
      'SELECT owner FROM identity_bindings WHERE app_user_id = $1',
      [appUserId],
    );
    return result.rowCount === 0 ? null : (result.rows[0]?.owner ?? null);
  }

  async getByOwner(owner: string): Promise<AgentConsoleView | null> {
    const agents = await this.pool.query<AgentRow>(
      `SELECT id, owner, name, persona, goal, status, config_version, created_at, updated_at
         FROM agents WHERE owner = $1`,
      [owner],
    );
    const agent = agents.rows[0];
    if (agent === undefined) return null;

    const configs = await this.pool.query<ConfigRow>(
      `SELECT version, config_json_encrypted, created_at
         FROM agent_configs WHERE agent_id = $1 ORDER BY version DESC`,
      [agent.id],
    );
    const actions = await this.pool.query<ActionRow>(
      `SELECT id, action_type, status, target_id, tx_hash, created_at, updated_at
         FROM action_intents WHERE owner = $1 ORDER BY updated_at DESC LIMIT 20`,
      [owner],
    );

    return {
      agentId: agent.id,
      owner: agent.owner,
      name: agent.name,
      persona: agent.persona,
      goal: agent.goal,
      status: agent.status,
      configVersion: agent.config_version,
      createdAt: agent.created_at.toISOString(),
      updatedAt: agent.updated_at.toISOString(),
      versions: configs.rows.map(decodeConfig),
      recentActions: actions.rows.map(
        (row): AgentActionView => ({
          id: row.id,
          actionType: row.action_type,
          status: row.status,
          targetId: row.target_id,
          txHash: row.tx_hash,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        }),
      ),
    };
  }

  async saveConfig(input: {
    owner: string;
    name: string;
    persona: Persona;
    goal: Goal;
    expectedVersion: number | null;
  }): Promise<AgentConfigSaveResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; status: AgentStatus; config_version: number }>(
        'SELECT id, status, config_version FROM agents WHERE owner = $1 FOR UPDATE',
        [input.owner],
      );
      const row = existing.rows[0];

      let agentId: string;
      let version: number;
      let status: AgentStatus;

      if (row === undefined) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO agents (owner, name, persona, goal, status, config_version)
           VALUES ($1, $2, $3, $4, 'ACTIVE', 1) RETURNING id`,
          [input.owner, input.name, input.persona, input.goal],
        );
        const insertedRow = inserted.rows[0];
        if (insertedRow === undefined) throw new Error('agent insert returned no row');
        agentId = insertedRow.id;
        version = 1;
        status = 'ACTIVE';
      } else {
        if (input.expectedVersion !== null && input.expectedVersion !== row.config_version) {
          throw new AgentVersionConflictError();
        }
        agentId = row.id;
        version = row.config_version + 1;
        status = row.status;
        await endCommandsForConfig(client, agentId, row.config_version);
        await client.query(
          `UPDATE agents SET name = $2, persona = $3, goal = $4, config_version = $5, updated_at = now()
             WHERE owner = $1`,
          [input.owner, input.name, input.persona, input.goal, version],
        );
      }

      const encoded = encodeConfig(configSnapshot(input.name, input.persona, input.goal, status === 'PAUSED'));
      await client.query(
        `INSERT INTO agent_configs (agent_id, version, config_json_encrypted, config_hash)
         VALUES ($1, $2, $3, $4)`,
        [agentId, version, encoded.bytes, encoded.hash],
      );
      await client.query('COMMIT');
      return { agentId, configVersion: version, status };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (
        error instanceof AgentVersionConflictError ||
        (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505')
      ) {
        throw new AgentVersionConflictError();
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async setPaused(owner: string, paused: boolean): Promise<AgentConfigSaveResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{
        id: string;
        name: string;
        persona: Persona;
        goal: Goal;
        status: AgentStatus;
        config_version: number;
      }>(
        'SELECT id, name, persona, goal, status, config_version FROM agents WHERE owner = $1 FOR UPDATE',
        [owner],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        await client.query('COMMIT');
        return null;
      }

      const desired: AgentStatus = paused ? 'PAUSED' : 'ACTIVE';
      if (row.status === desired) {
        await client.query('COMMIT');
        return { agentId: row.id, configVersion: row.config_version, status: row.status };
      }

      const version = row.config_version + 1;
      await endCommandsForConfig(client, row.id, row.config_version);
      await client.query(
        'UPDATE agents SET status = $2, config_version = $3, updated_at = now() WHERE owner = $1',
        [owner, desired, version],
      );
      const encoded = encodeConfig(configSnapshot(row.name, row.persona, row.goal, paused));
      await client.query(
        `INSERT INTO agent_configs (agent_id, version, config_json_encrypted, config_hash)
         VALUES ($1, $2, $3, $4)`,
        [row.id, version, encoded.bytes, encoded.hash],
      );
      await client.query('COMMIT');
      return { agentId: row.id, configVersion: version, status: desired };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
