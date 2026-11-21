import type { ProposalStatus } from '@agent-republic/domain';

/**
 * Read-model ports for the E2-03 read-only API.
 *
 * All chain-derived values come from `chain_events` rows that are both
 * INCLUDED and finalized (`confirmed_at_block IS NOT NULL`) plus contract
 * reads. Pending or orphaned events never reach these shapes.
 */

export type SyncState = 'SYNCED' | 'DELAYED' | 'UNKNOWN';

export type SyncStatus = {
  readonly state: SyncState;
  readonly finalizedBlock: bigint | null;
  readonly syncedAt: Date | null;
};

export type ProposalRow = {
  readonly chainProposalId: string;
  readonly owner: string;
  readonly contentHash: string;
  readonly deadline: Date;
  readonly status: ProposalStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type VoteTally = {
  readonly yes: number;
  readonly no: number;
  readonly abstain: number;
  /** VoteCast rows whose choice byte is outside the YES/NO/ABSTAIN set. */
  readonly unclassified: number;
};

export type TxLink = {
  readonly txHash: string;
  readonly eventName: string;
  readonly blockNumber: string;
};

export type ProjectRow = {
  readonly chainProjectId: string;
  readonly name: string;
  readonly goalBuild: string;
  readonly fundedBuild: string;
  readonly state: 'FUNDING' | 'COMPLETED';
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ContributorRow = {
  readonly owner: string;
  readonly amount: string;
};

export type IdentityProjection = {
  readonly registered: boolean;
  readonly registeredTxHash: string | null;
  readonly registeredBlock: string | null;
};

export type ActivityRow = {
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: string;
  readonly eventName: string;
  readonly owner: string | null;
  readonly confirmedAtBlock: string;
};

export interface ApiProjectionReader {
  ping(): Promise<void>;
  getSyncStatus(chainId: 56 | 97): Promise<SyncStatus>;
  listProposals(status?: ProposalStatus): Promise<ProposalRow[]>;
  findProposal(chainProposalId: string): Promise<ProposalRow | null>;
  getProposalVotes(chainId: 56 | 97, chainProposalId: string): Promise<VoteTally>;
  listProposalTxLinks(chainId: 56 | 97, chainProposalId: string): Promise<TxLink[]>;
  listProjects(): Promise<ProjectRow[]>;
  findProject(chainProjectId: string): Promise<ProjectRow | null>;
  getProjectContributors(chainId: 56 | 97, chainProjectId: string): Promise<ContributorRow[]>;
  listProjectTxLinks(chainId: 56 | 97, chainProjectId: string): Promise<TxLink[]>;
  getIdentityProjection(chainId: 56 | 97, owner: string): Promise<IdentityProjection>;
  /** Confirmed event feed, newest first — the Activity page data source. */
  listActivity(chainId: 56 | 97, limit: number): Promise<ActivityRow[]>;
}
