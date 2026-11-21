import { describe, expect, it } from 'vitest';
import {
  ChainEventError,
  eventDedupeKey,
  normalizeLog,
  normalizeLogs,
  type RawChainLog,
} from '../src/index.js';

const OWNER = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const OWNER_LOWER = OWNER.toLowerCase();
const HASH = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const CONTRACT = '0x1111111111111111111111111111111111111111';

function log(overrides: Partial<RawChainLog> = {}): RawChainLog {
  return {
    blockNumber: 100n,
    blockHash: HASH(1),
    transactionHash: HASH(2),
    logIndex: 0,
    address: CONTRACT,
    eventName: 'CitizenRegistered',
    args: { owner: OWNER, commitment: HASH(3) },
    ...overrides,
  };
}

describe('normalizeLog', () => {
  it('lowercases the owner and hex arguments', () => {
    const draft = normalizeLog(56, log());
    expect(draft.owner).toBe(OWNER_LOWER);
    expect(draft.blockHash).toBe(HASH(1));
    expect(draft.txHash).toBe(HASH(2));
    expect(draft.payload.commitment).toBe(HASH(3));
    expect(draft.eventName).toBe('CitizenRegistered');
  });

  it('serializes uint128/uint256 arguments as decimal strings (no precision loss)', () => {
    const draft = normalizeLog(
      56,
      log({
        eventName: 'ContributionMade',
        args: {
          owner: OWNER,
          projectId: 1n,
          amount: 18446744073709551615n,
          fundedAfter: 2000n,
        },
      }),
    );
    expect(draft.payload.amount).toBe('18446744073709551615');
    expect(draft.payload.projectId).toBe('1');
    expect(draft.payload.fundedAfter).toBe('2000');
  });

  it('leaves owner null for events without a citizen subject', () => {
    const draft = normalizeLog(
      56,
      log({
        eventName: 'ProposalFinalized',
        args: { proposalId: 7n, status: 1, yes: 3, no: 0, abstain: 1 },
      }),
    );
    expect(draft.owner).toBeNull();
  });

  it('rejects unknown events instead of guessing a schema', () => {
    expect(() => normalizeLog(56, log({ eventName: 'Transfer' }))).toThrow(ChainEventError);
  });

  it('rejects removed (reorged) logs', () => {
    expect(() => normalizeLog(56, log({ removed: true }))).toThrow(/removed logs/);
  });

  it('rejects malformed tx hashes', () => {
    expect(() => normalizeLog(56, log({ transactionHash: '0xdeadbeef' }))).toThrow(/txHash/);
  });

  it('rejects events missing their owner argument', () => {
    expect(() => normalizeLog(56, log({ args: { commitment: HASH(3) } }))).toThrow(/missing the "owner"/);
  });

  it('rejects non-integer log indexes', () => {
    expect(() => normalizeLog(56, log({ logIndex: -1 }))).toThrow(/logIndex/);
  });
});

describe('normalizeLogs', () => {
  it('drops removed logs, de-duplicates and sorts by (blockNumber, logIndex)', () => {
    const drafts = normalizeLogs(56, [
      log({ blockNumber: 102n, logIndex: 1, transactionHash: HASH(12) }),
      log({ blockNumber: 101n, logIndex: 3, transactionHash: HASH(11) }),
      // duplicate of the first event
      log({ blockNumber: 102n, logIndex: 1, transactionHash: HASH(12) }),
      log({ blockNumber: 103n, logIndex: 0, transactionHash: HASH(13), removed: true }),
    ]);
    expect(drafts.map((draft) => `${draft.blockNumber}:${draft.logIndex}`)).toEqual([
      '101:3',
      '102:1',
    ]);
  });

  it('builds a stable dedupe key from (chainId, txHash, logIndex)', () => {
    const draft = normalizeLog(56, log());
    expect(eventDedupeKey(draft)).toBe(`56:${HASH(2)}:0`);
  });
});
