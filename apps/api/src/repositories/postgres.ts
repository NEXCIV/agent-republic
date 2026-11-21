import { Pool } from 'pg';
import type { ProposalStatus } from '@agent-republic/domain';
import type {
  ActivityRow,
  ApiProjectionReader,
  ContributorRow,
  IdentityProjection,
  ProposalRow,
  ProjectRow,
  SyncStatus,
  TxLink,
  VoteTally,
} from '../ports.js';

/**
 * Postgres read model for E2-03.
 *
 * Confirmed-only rule: every chain_events query filters
 * `status = 'INCLUDED' AND confirmed_at_block IS NOT NULL`, so pending or
 * reorged transactions can never surface as project progress (AGENTS.md §4).
 */

type ProposalDbRow = {
  chain_proposal_id: string;
  owner: string;
  content_hash: string;
  deadline: Date;
  status: ProposalStatus;
  created_at: Date;
  updated_at: Date;
};

type ProjectDbRow = {
  chain_project_id: string;
  name: string;
  goal_build: string;
  funded_build: string;
  state: 'FUNDING' | 'COMPLETED';
  created_at: Date;
  updated_at: Date;
};

const CONFIRMED_EVENTS = "status = 'INCLUDED' AND confirmed_at_block IS NOT NULL";

const toProposal = (row: ProposalDbRow): ProposalRow => ({
  chainProposalId: row.chain_proposal_id,
  owner: row.owner,
  contentHash: row.content_hash,
  deadline: row.deadline,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toProject = (row: ProjectDbRow): ProjectRow => ({
  chainProjectId: row.chain_project_id,
  name: row.name,
  goalBuild: row.goal_build,
  fundedBuild: row.funded_build,
  state: row.state,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class PostgresProjectionReader implements ApiProjectionReader {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    if (connectionString.trim() === '') {
      throw new Error('[api] DATABASE_URL is required; refusing to start without a database');
    }
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async getSyncStatus(chainId: 56 | 97): Promise<SyncStatus> {
    const result = await this.pool.query<{ finalized_block: string | null; updated_at: Date | null }>(
      `SELECT max(finalized_block)::text AS finalized_block, max(updated_at) AS updated_at
         FROM chain_sync_cursors
        WHERE chain_id = $1`,
      [chainId],
    );
    const row = result.rows[0];
    if (row?.finalized_block === null || row?.finalized_block === undefined) {
      return { state: 'UNKNOWN', finalizedBlock: null, syncedAt: null };
    }
    return {
      state: 'SYNCED',
      finalizedBlock: BigInt(row.finalized_block),
      syncedAt: row.updated_at,
    };
  }

  async listProposals(status?: ProposalStatus): Promise<ProposalRow[]> {
    const params: unknown[] = [];
    let where = '';
    if (status !== undefined) {
      params.push(status);
      where = 'WHERE status = $1';
    }
    const result = await this.pool.query<ProposalDbRow>(
      `SELECT chain_proposal_id::text, owner, content_hash, deadline, status, created_at, updated_at
         FROM proposals
         ${where}
        ORDER BY chain_proposal_id DESC
        LIMIT 200`,
      params,
    );
    return result.rows.map(toProposal);
  }

  async findProposal(chainProposalId: string): Promise<ProposalRow | null> {
    const result = await this.pool.query<ProposalDbRow>(
      `SELECT chain_proposal_id::text, owner, content_hash, deadline, status, created_at, updated_at
         FROM proposals
        WHERE chain_proposal_id = $1`,
      [chainProposalId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toProposal(row);
  }

  async getProposalVotes(chainId: 56 | 97, chainProposalId: string): Promise<VoteTally> {
    const result = await this.pool.query<{
      yes: number;
      no: number;
      abstain: number;
      unclassified: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE payload->>'choice' = '1')::int AS yes,
         count(*) FILTER (WHERE payload->>'choice' = '2')::int AS no,
         count(*) FILTER (WHERE payload->>'choice' = '3')::int AS abstain,
         count(*) FILTER (WHERE payload->>'choice' NOT IN ('1', '2', '3'))::int AS unclassified
       FROM chain_events
       WHERE chain_id = $1
         AND event_name = 'VoteCast'
         AND payload->>'proposalId' = $2
         AND ${CONFIRMED_EVENTS}`,
      [chainId, chainProposalId],
    );
    const row = result.rows[0];
    return {
      yes: row?.yes ?? 0,
      no: row?.no ?? 0,
      abstain: row?.abstain ?? 0,
      unclassified: row?.unclassified ?? 0,
    };
  }

  async listProposalTxLinks(chainId: 56 | 97, chainProposalId: string): Promise<TxLink[]> {
    return this.listTxLinks(chainId, 'proposalId', chainProposalId, [
      'ProposalSubmitted',
      'VoteCast',
      'ProposalFinalized',
    ]);
  }

  async listProjects(): Promise<ProjectRow[]> {
    const result = await this.pool.query<ProjectDbRow>(
      `SELECT chain_project_id::text, name, goal_build::text, funded_build::text, state, created_at, updated_at
         FROM projects
        ORDER BY chain_project_id DESC
        LIMIT 100`,
    );
    return result.rows.map(toProject);
  }

  async findProject(chainProjectId: string): Promise<ProjectRow | null> {
    const result = await this.pool.query<ProjectDbRow>(
      `SELECT chain_project_id::text, name, goal_build::text, funded_build::text, state, created_at, updated_at
         FROM projects
        WHERE chain_project_id = $1`,
      [chainProjectId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toProject(row);
  }

  async getProjectContributors(chainId: 56 | 97, chainProjectId: string): Promise<ContributorRow[]> {
    const result = await this.pool.query<{ owner: string; amount: string }>(
      `SELECT owner, sum((payload->>'amount')::numeric)::text AS amount
         FROM chain_events
        WHERE chain_id = $1
          AND event_name = 'ContributionMade'
          AND payload->>'projectId' = $2
          AND owner IS NOT NULL
          AND ${CONFIRMED_EVENTS}
        GROUP BY owner
        ORDER BY sum((payload->>'amount')::numeric) DESC
        LIMIT 100`,
      [chainId, chainProjectId],
    );
    return result.rows;
  }

  async listProjectTxLinks(chainId: 56 | 97, chainProjectId: string): Promise<TxLink[]> {
    return this.listTxLinks(chainId, 'projectId', chainProjectId, [
      'ProjectCreated',
      'ContributionMade',
      'ProjectCompleted',
    ]);
  }

  async getIdentityProjection(chainId: 56 | 97, owner: string): Promise<IdentityProjection> {
    const result = await this.pool.query<{ tx_hash: string; block_number: string }>(
      `SELECT tx_hash, block_number::text AS block_number
         FROM chain_events
        WHERE chain_id = $1
          AND event_name = 'CitizenRegistered'
          AND owner = $2
          AND ${CONFIRMED_EVENTS}
        ORDER BY block_number DESC, log_index DESC
        LIMIT 1`,
      [chainId, owner],
    );
    const row = result.rows[0];
    return row === undefined
      ? { registered: false, registeredTxHash: null, registeredBlock: null }
      : { registered: true, registeredTxHash: row.tx_hash, registeredBlock: row.block_number };
  }

  async listActivity(chainId: 56 | 97, limit: number): Promise<ActivityRow[]> {
    const result = await this.pool.query<{
      tx_hash: string;
      log_index: number;
      block_number: string;
      event_name: string;
      owner: string | null;
      confirmed_at_block: string;
    }>(
      `SELECT tx_hash, log_index, block_number::text AS block_number, event_name, owner,
              confirmed_at_block::text AS confirmed_at_block
         FROM chain_events
        WHERE chain_id = $1 AND ${CONFIRMED_EVENTS}
        ORDER BY block_number DESC, log_index DESC
        LIMIT $2`,
      [chainId, limit],
    );
    return result.rows.map((row) => ({
      txHash: row.tx_hash,
      logIndex: row.log_index,
      blockNumber: row.block_number,
      eventName: row.event_name,
      owner: row.owner,
      confirmedAtBlock: row.confirmed_at_block,
    }));
  }

  private async listTxLinks(
    chainId: 56 | 97,
    payloadKey: 'proposalId' | 'projectId',
    value: string,
    eventNames: readonly string[],
  ): Promise<TxLink[]> {
    const result = await this.pool.query<{ tx_hash: string; event_name: string; block_number: string }>(
      `SELECT tx_hash, event_name, block_number::text AS block_number
         FROM chain_events
        WHERE chain_id = $1
          AND payload->>'${payloadKey}' = $2
          AND event_name = ANY($3::text[])
          AND ${CONFIRMED_EVENTS}
        ORDER BY block_number, log_index
        LIMIT 50`,
      [chainId, value, eventNames],
    );
    return result.rows.map((row) => ({
      txHash: row.tx_hash,
      eventName: row.event_name,
      blockNumber: row.block_number,
    }));
  }
}
