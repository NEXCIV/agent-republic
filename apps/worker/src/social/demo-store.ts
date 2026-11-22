import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { retrieveMemories } from '@agent-republic/agent-engine';
import { createDemoPair, type DemoResolution } from './demo-decisions.js';

type Session = {
  id: string;
  inviter_id: string;
  recipient_id: string;
  status: 'INVITED' | DemoResolution['status'];
  invited_at: Date;
  resolved_at: Date | null;
  reason: string | null;
  recalled_session_id: string | null;
  messages: DemoResolution['messages'];
  memories: DemoResolution['memories'];
};

const RESPONSE_DELAY_MS = 5_000;
const COOLDOWN_MS = 60_000;
const INVITE_LIMIT_PER_DAY = 4;
const DEMO_LOCK = 71408305;
const schema = new URL('../../../../db/demo/agent-social.sql', import.meta.url);

export class DemoSocialStore {
  private readonly pool: Pool;
  private readonly demo: ReturnType<typeof createDemoPair>;

  constructor(databaseUrl: string, frame: unknown) {
    if (!/^\/[a-z][a-z0-9_]*_social_demo$/.test(new URL(databaseUrl).pathname)) {
      throw new Error('DEMO needs a dedicated database whose name ends in _social_demo');
    }
    this.demo = createDemoPair(frame);
    this.pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000 });
  }

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [DEMO_LOCK]);
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async initialize(): Promise<void> {
    const sql = await readFile(schema, 'utf8');
    await this.transaction(async (client) => { await client.query(sql); });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async history(): Promise<Session[]> {
    const { rows } = await this.pool.query<Session>(
      'SELECT * FROM demo_social_sessions ORDER BY invited_at DESC, id DESC LIMIT 20',
    );
    return rows;
  }

  async setPaused(agentId: string, paused: boolean): Promise<void> {
    if (!this.demo.pair.some((agent) => agent.agentId === agentId)) {
      throw new Error('Unknown DEMO agent ID');
    }
    await this.transaction(async (client) => {
      if (paused) {
        await client.query('INSERT INTO demo_social_pauses (agent_id) VALUES ($1) ON CONFLICT DO NOTHING', [agentId]);
        await client.query(
          `UPDATE demo_social_sessions SET status = 'CANCELLED', reason = 'PARTICIPANT_PAUSED',
             resolved_at = greatest(clock_timestamp(), invited_at)
           WHERE status = 'INVITED' AND $1 IN (inviter_id, recipient_id)`,
          [agentId],
        );
      } else {
        await client.query('DELETE FROM demo_social_pauses WHERE agent_id = $1', [agentId]);
      }
    });
  }

  async step(): Promise<Session | null> {
    return this.transaction(async (client) => {
      const time = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      const now = time.rows[0]!.now;
      const { rows: pauses } = await client.query<{ agent_id: string }>('SELECT agent_id FROM demo_social_pauses');
      if (this.demo.pair.some((agent) => pauses.some((pause) => pause.agent_id === agent.agentId))) return null;

      const latest = (await client.query<Session>(
        'SELECT * FROM demo_social_sessions ORDER BY invited_at DESC, id DESC LIMIT 1',
      )).rows[0];
      if (latest?.status === 'INVITED') {
        if (now.getTime() - latest.invited_at.getTime() < RESPONSE_DELAY_MS) return null;
        const inviter = this.demo.pair.find((agent) => agent.agentId === latest.inviter_id);
        const recipient = this.demo.pair.find((agent) => agent.agentId === latest.recipient_id);
        if (!inviter || !recipient) throw new Error('Stored invitation does not match the DEMO pair');
        const resolution = this.demo.resolve(latest.id, inviter, recipient, latest.recalled_session_id !== null, now);
        const updated = await client.query<Session>(
          `UPDATE demo_social_sessions SET status = $2, reason = $3, resolved_at = $4,
             messages = $5::jsonb, memories = $6::jsonb WHERE id = $1 RETURNING *`,
          [latest.id, resolution.status, resolution.reason, now, JSON.stringify(resolution.messages),
            JSON.stringify(resolution.memories)],
        );
        return updated.rows[0]!;
      }

      if (!this.demo.hasTopic || (latest?.resolved_at && now.getTime() - latest.resolved_at.getTime() < COOLDOWN_MS)) return null;
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const count = await client.query<{ count: string }>(
        'SELECT count(*) FROM demo_social_sessions WHERE invited_at >= $1', [dayStart],
      );
      if (Number(count.rows[0]!.count) >= INVITE_LIMIT_PER_DAY) return null;

      const [first, second] = this.demo.pair;
      const [inviter, recipient] = latest?.inviter_id === first.agentId ? [second, first] : [first, second];
      const previous = (await client.query<Pick<Session, 'id' | 'memories'>>(
        `SELECT id, memories FROM demo_social_sessions
           WHERE status = 'COMPLETED'
             AND ((inviter_id = $1 AND recipient_id = $2) OR (inviter_id = $2 AND recipient_id = $1))
           ORDER BY invited_at DESC, id DESC LIMIT 1`,
        [inviter.agentId, recipient.agentId],
      )).rows[0];
      const recalledSession = previous &&
        retrieveMemories(previous.memories, { agentId: inviter.agentId }).some((memory) => memory.kind === 'SOCIAL')
        ? previous.id
        : null;
      const created = await client.query<Session>(
        `INSERT INTO demo_social_sessions (inviter_id, recipient_id, invited_at, recalled_session_id)
           VALUES ($1, $2, $3, $4) RETURNING *`,
        [inviter.agentId, recipient.agentId, now, recalledSession],
      );
      return created.rows[0]!;
    });
  }
}
