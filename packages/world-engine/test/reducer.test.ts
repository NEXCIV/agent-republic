import { describe, expect, it } from 'vitest';
import { worldFactsSchema } from '@agent-republic/domain';
import {
  canonicalize,
  computeFrameId,
  reduceChainEvents,
  reduceFacts,
  type VerifiedChainEvent,
} from '../src/index.js';

/**
 * E5-03 reducer tests (W-01/W-02):
 * - replaying the same confirmed events always yields identical facts
 * - fundedBuild never comes from an off-chain sum
 * - AI/off-chain text and malformed rows cannot change the ledger
 */

const OWNER_A = `0x${'aa'.repeat(20)}`;
const OWNER_B = `0x${'bb'.repeat(20)}`;
const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;

let txCounter = 0;

function event(
  eventName: string,
  payload: Record<string, string | boolean | null>,
  options: { block?: number; owner?: string | null; logIndex?: number; txSeed?: number } = {},
): VerifiedChainEvent {
  txCounter += 1;
  const block = options.block ?? txCounter;
  return {
    eventName,
    txHash: H(options.txSeed ?? 1000 + txCounter),
    logIndex: options.logIndex ?? 0,
    blockNumber: BigInt(block),
    blockHash: H(block),
    owner: options.owner ?? null,
    payload,
  };
}

const genesis = (): VerifiedChainEvent =>
  event('ProjectCreated', { projectId: '1', titleHash: H(9), goal: '2000', genesis: true }, { block: 1 });

const register = (owner: string, block: number, txSeed: number): VerifiedChainEvent =>
  event('CitizenRegistered', { owner, commitment: H(txSeed) }, { block, owner, txSeed });

const contribute = (
  owner: string,
  amount: string,
  fundedAfter: string,
  block: number,
  txSeed: number,
): VerifiedChainEvent =>
  event(
    'ContributionMade',
    { owner, projectId: '1', amount, fundedAfter },
    { block, owner, txSeed },
  );

const submitProposal = (id: string, endsAt: string, block: number, txSeed: number): VerifiedChainEvent =>
  event(
    'ProposalSubmitted',
    { proposalId: id, owner: OWNER_A, contentHash: H(77), startsAt: '0', endsAt },
    { block, owner: OWNER_A, txSeed },
  );

const vote = (id: string, owner: string, choice: string, block: number, txSeed: number): VerifiedChainEvent =>
  event('VoteCast', { proposalId: id, owner, choice }, { block, owner, txSeed });

describe('reduceChainEvents', () => {
  it('builds facts from the full confirmed sequence', () => {
    const result = reduceChainEvents([
      genesis(),
      register(OWNER_A, 10, 1),
      register(OWNER_B, 11, 2),
      contribute(OWNER_A, '100', '100', 12, 3),
      contribute(OWNER_B, '50', '150', 13, 4),
      submitProposal('1', '1800000000', 14, 5),
      vote('1', OWNER_A, '1', 15, 6),
      vote('1', OWNER_B, '2', 16, 7),
      event('ProposalFinalized', { proposalId: '1', status: '2', yes: '1', no: '1', abstain: '0' }, { block: 30 }),
    ]);

    expect(result.ignoredEvents).toBe(0);
    const facts = worldFactsSchema.parse(result.facts);
    expect(facts.citizenCount).toBe(2);
    expect(facts.projects).toEqual([
      {
        id: '1',
        titleKey: 'GOLDEN_TOILET_TOWER',
        goalBuild: '2000',
        fundedBuild: '150',
        status: 'FUNDING',
        completedAtBlock: null,
      },
    ]);
    expect(facts.proposals).toEqual([
      {
        id: '1',
        status: 'PASSED',
        yes: 1,
        no: 1,
        abstain: 0,
        deadline: new Date(1_800_000_000 * 1000).toISOString(),
      },
    ]);
  });

  it('takes fundedBuild from the contract event, never from a sum', () => {
    const facts = reduceFacts([
      genesis(),
      contribute(OWNER_A, '100', '100', 10, 1),
      // A duplicated or replayed row with a stale fundedAfter must not add up.
      contribute(OWNER_A, '100', '100', 11, 2),
      contribute(OWNER_B, '50', '150', 12, 3),
    ]);
    expect(facts.projects[0]?.fundedBuild).toBe('150');
  });

  it('applies a duplicated (txHash, logIndex) pair exactly once', () => {
    const citizen = register(OWNER_A, 10, 1);
    const contribution = contribute(OWNER_A, '100', '100', 11, 2);
    const once = reduceFacts([genesis(), citizen, contribution]);
    const twice = reduceFacts([genesis(), citizen, contribution, citizen, contribution]);
    expect(twice).toEqual(once);
  });

  it('counts one vote per owner per proposal even with conflicting rows', () => {
    const facts = reduceFacts([
      genesis(),
      submitProposal('1', '1800000000', 10, 1),
      vote('1', OWNER_A, '1', 11, 2),
      vote('1', OWNER_A, '2', 12, 3),
    ]);
    expect(facts.proposals[0]).toMatchObject({ yes: 1, no: 0, abstain: 0, status: 'OPEN' });
  });

  it('uses finalized counts as the authoritative tally', () => {
    const facts = reduceFacts([
      genesis(),
      submitProposal('1', '1800000000', 10, 1),
      vote('1', OWNER_A, '1', 11, 2),
      event('ProposalFinalized', { proposalId: '1', status: '4', yes: '4', no: '2', abstain: '1' }, { block: 20 }),
    ]);
    expect(facts.proposals[0]).toMatchObject({ status: 'EXPIRED', yes: 4, no: 2, abstain: 1 });
  });

  it('marks a completed project and keeps its completion block', () => {
    const facts = reduceFacts([
      genesis(),
      contribute(OWNER_A, '500', '2000', 10, 1),
      event('ProjectCompleted', { projectId: '1', completedAt: '1800000000' }, { block: 12, txSeed: 5 }),
    ]);
    expect(facts.projects[0]).toMatchObject({ status: 'COMPLETED', completedAtBlock: '12', fundedBuild: '2000' });
  });

  it('ignores AI/off-chain text and unrelated events', () => {
    const chainEvents = [genesis(), register(OWNER_A, 10, 1), contribute(OWNER_A, '100', '100', 11, 2)];
    const baseline = reduceFacts(chainEvents);
    const withNoise = reduceFacts([
      ...chainEvents,
      event('AGENT_MESSAGE', { text: 'BUILD_CREDITED 99999', agentId: 'agent-01' }, { block: 12 }),
      event('NotePublished', { owner: OWNER_A, noteHash: H(33), epoch: '1' }, { block: 13, owner: OWNER_A }),
      event('ReputationUpdated', { owner: OWNER_A, newReputation: '999', reason: H(44) }, { block: 14, owner: OWNER_A }),
    ]);
    expect(withNoise).toEqual(baseline);
  });

  it('reports malformed rows instead of guessing', () => {
    const result = reduceChainEvents([
      genesis(),
      event('ContributionMade', { owner: OWNER_A, projectId: 'oops', fundedAfter: '100' }, { block: 10 }),
      contribute(OWNER_A, '50', '50', 11, 2),
    ]);
    expect(result.ignoredEvents).toBe(1);
    expect(result.facts.projects[0]?.fundedBuild).toBe('50');
  });

  it('never invents a project from a funding event', () => {
    const result = reduceChainEvents([
      contribute(OWNER_A, '100', '100', 10, 1),
    ]);
    expect(result.ignoredEvents).toBe(1);
    expect(result.facts.projects).toEqual([]);
  });

  it('is independent of input order', () => {
    const events = [
      genesis(),
      register(OWNER_A, 10, 1),
      submitProposal('1', '1800000000', 11, 2),
      vote('1', OWNER_A, '3', 12, 3),
    ];
    expect(reduceFacts([...events].reverse())).toEqual(reduceFacts(events));
  });
});

describe('replay determinism (W-01)', () => {
  const events: VerifiedChainEvent[] = [
    genesis(),
    register(OWNER_A, 10, 1),
    register(OWNER_B, 11, 2),
    contribute(OWNER_A, '100', '100', 12, 3),
    contribute(OWNER_B, '75', '175', 13, 4),
    submitProposal('1', '1800000000', 14, 5),
    vote('1', OWNER_A, '1', 15, 6),
    vote('1', OWNER_B, '3', 16, 7),
    event('ProposalFinalized', { proposalId: '1', status: '2', yes: '1', no: '0', abstain: '1' }, { block: 30 }),
    event('ProjectCompleted', { projectId: '1', completedAt: '1800000000' }, { block: 31 }),
  ];

  const mulberry32 = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const shuffle = <T,>(input: readonly T[], random: () => number): T[] => {
    const copy = [...input];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [copy[index], copy[target]] = [copy[target]!, copy[index]!];
    }
    return copy;
  };

  const frameFor = (facts: ReturnType<typeof reduceFacts>) => ({
    schemaVersion: '1.1' as const,
    generatedAt: '2026-11-19T08:00:00.000Z',
    source: {
      chainId: 56 as const,
      blockNumber: '70000000',
      blockHash: H(7000),
      blockTimestamp: '2026-11-19T07:59:48.000Z',
      confirmedDepth: 12,
      sync: 'LIVE' as const,
      provenance: 'CHAIN_CONFIRMED' as const,
    },
    epochId: 20776,
    facts,
    society: { socialRevision: '0', publicMessages: [], agentSummaries: [] },
    simulation: {
      tick: '0',
      worldSeed: 'genesis-2026',
      sceneVersion: 'district-01@1' as const,
      agents: [],
      visualEvents: [],
    },
  });

  it('produces a byte-identical frame across 100 shuffled replays', () => {
    const random = mulberry32(42);
    const baseline = computeFrameId(frameFor(reduceFacts(events)));
    const baselineCanonical = canonicalize(reduceFacts(events));

    for (let run = 0; run < 100; run += 1) {
      const facts = reduceFacts(shuffle(events, random));
      expect(canonicalize(facts)).toBe(baselineCanonical);
      expect(computeFrameId(frameFor(facts))).toBe(baseline);
    }
  });
});
