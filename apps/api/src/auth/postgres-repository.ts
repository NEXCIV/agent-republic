import { Pool } from 'pg';
import type { BindingRepository, CommitOutcome } from './binding.js';

/**
 * E2-04 persistence.
 *
 * commitBinding is intentionally one transaction with a row lock: a challenge
 * can be consumed at most once, and a failed binding attempt (wrong owner,
 * pending event, duplicate account) rolls back without burning the challenge.
 */

type ChallengeDbRow = {
  app_user_id: string;
  owner: string;
  commitment: string;
  expires_at: Date;
  used_at: Date | null;
};

type EventDbRow = {
  owner: string | null;
  tx_hash: string;
  status: 'INCLUDED' | 'ORPHANED';
  confirmed_at_block: string | null;
};

export class PostgresBindingRepository implements BindingRepository {
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

  async createChallenge(input: {
    appUserId: string;
    owner: string;
    agentConfigHash: string;
    nonceHash: string;
    commitment: string;
    expiresAt: Date;
  }): Promise<{ id: string }> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO auth_challenges
         (app_user_id, owner, agent_config_hash, nonce_hash, commitment, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.appUserId,
        input.owner,
        input.agentConfigHash,
        input.nonceHash,
        input.commitment,
        input.expiresAt,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('[api] failed to create a binding challenge');
    }
    return { id: row.id };
  }

  async commitBinding(input: {
    challengeId: string;
    chainId: 56 | 97;
    appUserId: string;
    owner: string;
    txHash: string;
    now: Date;
  }): Promise<CommitOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const challenge = await client.query<ChallengeDbRow>(
        `SELECT app_user_id, owner, commitment, expires_at, used_at
           FROM auth_challenges
          WHERE id = $1
          FOR UPDATE`,
        [input.challengeId],
      );
      const row = challenge.rows[0];
      if (row === undefined) {
        await client.query('ROLLBACK');
        return { status: 'CHALLENGE_NOT_FOUND' };
      }
      // A challenge belonging to another Web2 account is indistinguishable
      // from a missing one — never reveal that it exists.
      if (row.app_user_id !== input.appUserId) {
        await client.query('ROLLBACK');
        return { status: 'CHALLENGE_NOT_FOUND' };
      }
      if (row.used_at !== null) {
        await client.query('ROLLBACK');
        return { status: 'CHALLENGE_USED' };
      }
      if (row.expires_at.getTime() <= input.now.getTime()) {
        await client.query('ROLLBACK');
        return { status: 'CHALLENGE_EXPIRED' };
      }
      if (row.owner !== input.owner) {
        await client.query('ROLLBACK');
        return { status: 'OWNER_MISMATCH' };
      }

      const event = await client.query<EventDbRow>(
        `SELECT owner, tx_hash, status, confirmed_at_block
           FROM chain_events
          WHERE chain_id = $1
            AND event_name = 'CitizenRegistered'
            AND payload->>'commitment' = $2
          ORDER BY block_number DESC, log_index DESC
          LIMIT 1`,
        [input.chainId, row.commitment],
      );
      const registration = event.rows[0];
      if (registration === undefined) {
        await client.query('ROLLBACK');
        return { status: 'EVENT_NOT_FOUND' };
      }
      if (registration.status !== 'INCLUDED' || registration.confirmed_at_block === null) {
        await client.query('ROLLBACK');
        return { status: 'EVENT_PENDING' };
      }
      if (registration.tx_hash !== input.txHash) {
        await client.query('ROLLBACK');
        return { status: 'TX_MISMATCH' };
      }
      if (registration.owner !== input.owner) {
        await client.query('ROLLBACK');
        return { status: 'OWNER_MISMATCH' };
      }

      await client.query('UPDATE auth_challenges SET used_at = $2 WHERE id = $1 AND used_at IS NULL', [
        input.challengeId,
        input.now,
      ]);

      // A unique violation aborts the whole transaction, so the insert is
      // guarded by a savepoint: roll back to it, classify the conflict, and
      // let the outer ROLLBACK discard the challenge consumption.
      await client.query('SAVEPOINT binding_insert');
      try {
        await client.query(
          `INSERT INTO identity_bindings (owner, app_user_id, registry_tx_hash)
           VALUES ($1, $2, $3)`,
          [input.owner, input.appUserId, registration.tx_hash],
        );
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') throw error;

        await client.query('ROLLBACK TO SAVEPOINT binding_insert');
        const byOwner = await client.query('SELECT 1 FROM identity_bindings WHERE owner = $1', [
          input.owner,
        ]);
        await client.query('ROLLBACK');
        return {
          status: byOwner.rowCount === 0 ? 'APP_USER_ALREADY_BOUND' : 'OWNER_ALREADY_BOUND',
        };
      }

      await client.query('COMMIT');
      return { status: 'BOUND', registryTxHash: registration.tx_hash };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
