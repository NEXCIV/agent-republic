/** Shapes returned by the E2 API (all amounts are decimal strings). */

export type SyncView = {
  state: 'SYNCED' | 'DELAYED' | 'UNKNOWN';
  finalizedBlock: string | null;
  syncedAt: string | null;
};

export type Envelope<T> = {
  chainId: number;
  source: string;
  sync: SyncView;
  data: T;
};

export type ProposalStatus = 'OPEN' | 'PASSED' | 'REJECTED' | 'EXPIRED';

export type ProposalListItem = {
  chainProposalId: string;
  owner: string;
  contentHash: string;
  deadline: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
};

export type VoteTally = { yes: number; no: number; abstain: number; unclassified: number };

export type TxLink = { txHash: string; eventName: string; blockNumber: string };

export type ProposalDetail = ProposalListItem & { votes: VoteTally; txLinks: TxLink[] };

export type ProjectListItem = {
  chainProjectId: string;
  name: string;
  goalBuild: string;
  fundedBuild: string;
  state: 'FUNDING' | 'COMPLETED';
  updatedAt: string;
};

export type Contributor = { owner: string; amount: string };

export type ProjectDetail = ProjectListItem & {
  contributors: Contributor[];
  txLinks: TxLink[];
  createdAt: string;
};

export type ActivityItem = {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  eventName: string;
  owner: string | null;
  confirmedAtBlock: string;
};

export type TxStatus = 'UNKNOWN' | 'PENDING' | 'INCLUDED' | 'CONFIRMED' | 'FAILED';

export type AgentPersona = 'COOPERATIVE' | 'PRAGMATIC' | 'COMPETITIVE' | 'RULE_BASED';

export type AgentGoal =
  | 'BUILD_PUBLIC_GOODS'
  | 'MAXIMIZE_REPUTATION'
  | 'DEFEND_RULES'
  | 'EXPLORE_COALITIONS';

export type AgentConfigVersion = {
  version: number;
  name: string;
  persona: AgentPersona;
  goal: AgentGoal;
  paused: boolean;
  createdAt: string;
};

export type AgentAction = {
  id: string;
  actionType: string;
  status: string;
  targetId: string | null;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MyAgentView = {
  agentId: string;
  owner: string;
  name: string;
  persona: AgentPersona;
  goal: AgentGoal;
  status: 'ACTIVE' | 'PAUSED';
  configVersion: number;
  createdAt: string;
  updatedAt: string;
  versions: AgentConfigVersion[];
  recentActions: AgentAction[];
};

export type TxStatusBody = {
  chainId: number;
  txHash: string;
  status: TxStatus;
  source: 'CHAIN_EVENTS' | 'RPC_RECEIPT' | 'INTENT' | 'NONE';
  events: { eventName: string; blockNumber: string; confirmed: boolean }[];
  receiptChecked: boolean;
  receiptBlockNumber: string | null;
  note?: string;
};
