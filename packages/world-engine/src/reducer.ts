import type { WorldFacts } from '@agent-republic/domain';

/**
 * E5-03 confirmed events → WorldFrame.facts reducer.
 *
 * Pure function: no network, no DB, no LLM, no clock, no Math.random.
 * Only finalized chain events may enter (the indexer guarantees it); this
 * module re-verifies shape and never lets off-chain/AI text change a fact.
 *
 * Rules:
 * - citizens are unique owners from CitizenRegistered
 * - project funding takes the event's `fundedAfter` (contract truth), never
 *   an off-chain sum, so pending or duplicated rows cannot inflate progress
 * - votes are one-per-owner per proposal; finalization overwrites the tally
 *   with the contract's authoritative counts
 * - duplicate (txHash, logIndex) rows are applied once (idempotent replay)
 */

export type VerifiedChainEvent = {
  readonly eventName: string;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly owner: string | null;
  readonly payload: Readonly<Record<string, string | boolean | null>>;
};

export type WorldFactsContext = {
  /** Optional id → display key table; genesis falls back to its known key. */
  readonly titleKeys?: Readonly<Record<string, string>>;
};

export type ReduceFactsResult = {
  readonly facts: WorldFacts;
  /** Events that changed facts. */
  readonly appliedEvents: number;
  /** Events with malformed payloads — a data-integrity signal. */
  readonly ignoredEvents: number;
};

export const GENESIS_TITLE_KEY = 'GOLDEN_TOILET_TOWER';

type ProjectState = {
  id: string;
  titleKey: string;
  goalBuild: string;
  fundedBuild: string;
  status: 'FUNDING' | 'COMPLETED';
  completedAtBlock: string | null;
};

type ProposalState = {
  id: string;
  status: 'OPEN' | 'PASSED' | 'REJECTED' | 'EXPIRED';
  yes: number;
  no: number;
  abstain: number;
  deadline: string;
};

const DECIMAL = /^\d+$/;
const VOTE_CODES: Readonly<Record<string, 'YES' | 'NO' | 'ABSTAIN'>> = {
  '1': 'YES',
  '2': 'NO',
  '3': 'ABSTAIN',
};
const PROPOSAL_STATUS_CODES: Readonly<Record<string, ProposalState['status']>> = {
  '2': 'PASSED',
  '3': 'REJECTED',
  '4': 'EXPIRED',
};

function decimal(value: unknown): bigint | null {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return null;
  return BigInt(value);
}

function timestampIso(value: unknown): string | null {
  const seconds = decimal(value);
  if (seconds === null) return null;
  if (seconds > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

function compareIds(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareEvents(left: VerifiedChainEvent, right: VerifiedChainEvent): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber < right.blockNumber ? -1 : 1;
  }
  return left.logIndex - right.logIndex;
}

export function reduceChainEvents(
  events: readonly VerifiedChainEvent[],
  context: WorldFactsContext = {},
): ReduceFactsResult {
  const citizens = new Set<string>();
  const projects = new Map<string, ProjectState>();
  const proposals = new Map<string, ProposalState>();
  const voters = new Map<string, Set<string>>();
  const seenLogs = new Set<string>();

  let appliedEvents = 0;
  let ignoredEvents = 0;

  const ordered = [...events].sort(compareEvents);

  for (const event of ordered) {
    const logKey = `${event.txHash.toLowerCase()}:${event.logIndex}`;
    if (seenLogs.has(logKey)) continue;
    seenLogs.add(logKey);

    const payload = event.payload;

    switch (event.eventName) {
      case 'CitizenRegistered': {
        if (event.owner === null) {
          ignoredEvents += 1;
          break;
        }
        const before = citizens.size;
        citizens.add(event.owner.toLowerCase());
        if (citizens.size !== before) appliedEvents += 1;
        break;
      }

      case 'ProjectCreated': {
        const projectId = decimal(payload.projectId);
        const goal = decimal(payload.goal);
        if (projectId === null || goal === null) {
          ignoredEvents += 1;
          break;
        }
        const id = projectId.toString();
        if (projects.has(id)) break;

        const isGenesis = payload.genesis === true;
        const titleKey =
          context.titleKeys?.[id] ?? (isGenesis ? GENESIS_TITLE_KEY : `PROJECT_${id}`);
        projects.set(id, {
          id,
          titleKey,
          goalBuild: goal.toString(),
          fundedBuild: '0',
          status: 'FUNDING',
          completedAtBlock: null,
        });
        appliedEvents += 1;
        break;
      }

      case 'ContributionMade': {
        const projectId = decimal(payload.projectId);
        const fundedAfter = decimal(payload.fundedAfter);
        if (projectId === null || fundedAfter === null) {
          ignoredEvents += 1;
          break;
        }
        const project = projects.get(projectId.toString());
        if (project === undefined) {
          // Never invent a project from a funding event.
          ignoredEvents += 1;
          break;
        }
        if (project.status === 'COMPLETED') break;
        project.fundedBuild = fundedAfter.toString();
        appliedEvents += 1;
        break;
      }

      case 'ProjectCompleted': {
        const projectId = decimal(payload.projectId);
        if (projectId === null) {
          ignoredEvents += 1;
          break;
        }
        const project = projects.get(projectId.toString());
        if (project === undefined) {
          ignoredEvents += 1;
          break;
        }
        project.status = 'COMPLETED';
        project.completedAtBlock = event.blockNumber.toString();
        appliedEvents += 1;
        break;
      }

      case 'ProposalSubmitted': {
        const proposalId = decimal(payload.proposalId);
        const deadline = timestampIso(payload.endsAt);
        if (proposalId === null || deadline === null) {
          ignoredEvents += 1;
          break;
        }
        const id = proposalId.toString();
        if (proposals.has(id)) break;
        proposals.set(id, { id, status: 'OPEN', yes: 0, no: 0, abstain: 0, deadline });
        appliedEvents += 1;
        break;
      }

      case 'VoteCast': {
        const proposalId = decimal(payload.proposalId);
        const choice = typeof payload.choice === 'string' ? VOTE_CODES[payload.choice] : undefined;
        if (proposalId === null || choice === undefined || event.owner === null) {
          ignoredEvents += 1;
          break;
        }
        const proposal = proposals.get(proposalId.toString());
        if (proposal === undefined) {
          ignoredEvents += 1;
          break;
        }
        const owner = event.owner.toLowerCase();
        const votersForProposal = voters.get(proposal.id) ?? new Set<string>();
        if (votersForProposal.has(owner)) break;
        votersForProposal.add(owner);
        voters.set(proposal.id, votersForProposal);

        if (choice === 'YES') proposal.yes += 1;
        else if (choice === 'NO') proposal.no += 1;
        else proposal.abstain += 1;
        appliedEvents += 1;
        break;
      }

      case 'ProposalFinalized': {
        const proposalId = decimal(payload.proposalId);
        const status =
          typeof payload.status === 'string' ? PROPOSAL_STATUS_CODES[payload.status] : undefined;
        if (proposalId === null || status === undefined) {
          ignoredEvents += 1;
          break;
        }
        const proposal = proposals.get(proposalId.toString());
        if (proposal === undefined) {
          ignoredEvents += 1;
          break;
        }
        const yes = decimal(payload.yes);
        const no = decimal(payload.no);
        const abstain = decimal(payload.abstain);
        if (yes === null || no === null || abstain === null) {
          ignoredEvents += 1;
          break;
        }
        proposal.status = status;
        proposal.yes = Number(yes);
        proposal.no = Number(no);
        proposal.abstain = Number(abstain);
        appliedEvents += 1;
        break;
      }

      default:
        // Notes, reputation and delegate events carry no world facts, and
        // unknown/AI-originated kinds are ignored by construction.
        break;
    }
  }

  const facts: WorldFacts = {
    citizenCount: citizens.size,
    projects: [...projects.values()]
      .sort((a, b) => compareIds(a.id, b.id))
      .map((project) => ({ ...project })),
    proposals: [...proposals.values()]
      .sort((a, b) => compareIds(a.id, b.id))
      .map((proposal) => ({ ...proposal })),
  };

  return { facts, appliedEvents, ignoredEvents };
}

export function reduceFacts(
  events: readonly VerifiedChainEvent[],
  context: WorldFactsContext = {},
): WorldFacts {
  return reduceChainEvents(events, context).facts;
}
