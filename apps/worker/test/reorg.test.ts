import { describe, expect, it } from 'vitest';
import {
  finalizedBlockFrom,
  findForkPoint,
  isConfirmed,
  nextScanRange,
  ReorgBelowFinalityError,
  type BlockRef,
} from '../src/index.js';

const block = (n: number, hashSeed = n): BlockRef => ({
  blockNumber: BigInt(n),
  blockHash: `0x${hashSeed.toString(16).padStart(64, '0')}`,
});

describe('findForkPoint', () => {
  it('returns null when every overlapping hash agrees', () => {
    expect(findForkPoint([block(1), block(2), block(3)], [block(1), block(2), block(3)], 0n)).toBeNull();
  });

  it('returns the lowest diverging block when the chain reorged', () => {
    const stored = [block(1), block(2), block(3), block(4), block(5)];
    const incoming = [block(1), block(2), block(3), block(4, 44), block(5, 55)];
    expect(findForkPoint(stored, incoming, 0n)).toBe(4n);
  });

  it('returns null when stored and incoming ranges do not overlap', () => {
    expect(findForkPoint([block(1), block(2)], [block(10), block(11)], 0n)).toBeNull();
  });

  it('fails closed when divergence touches finalized history', () => {
    const stored = [block(1), block(2), block(3)];
    const incoming = [block(1), block(2, 22), block(3, 33)];
    expect(() => findForkPoint(stored, incoming, 2n)).toThrow(ReorgBelowFinalityError);
  });

  it('allows divergence strictly above finality', () => {
    const stored = [block(1), block(2), block(3)];
    const incoming = [block(1), block(2), block(3, 33)];
    expect(findForkPoint(stored, incoming, 2n)).toBe(3n);
  });
});

describe('finalizedBlockFrom', () => {
  it('subtracts the confirmation depth', () => {
    expect(finalizedBlockFrom(100n, 12)).toBe(88n);
  });

  it('clamps to genesis during warm-up', () => {
    expect(finalizedBlockFrom(5n, 12)).toBe(0n);
  });

  it('rejects negative confirmation depth', () => {
    expect(() => finalizedBlockFrom(100n, -1)).toThrow(RangeError);
  });
});

describe('isConfirmed', () => {
  it('is inclusive at the finalized height', () => {
    expect(isConfirmed(88n, 88n)).toBe(true);
    expect(isConfirmed(89n, 88n)).toBe(false);
  });
});

describe('nextScanRange', () => {
  it('walks in bounded batches', () => {
    expect(nextScanRange(0n, 100n, 50)).toEqual({ fromBlock: 0n, toBlock: 49n });
    expect(nextScanRange(50n, 100n, 50)).toEqual({ fromBlock: 50n, toBlock: 99n });
  });

  it('clamps the last batch to head', () => {
    expect(nextScanRange(100n, 100n, 50)).toEqual({ fromBlock: 100n, toBlock: 100n });
  });

  it('returns null once the cursor passes head', () => {
    expect(nextScanRange(101n, 100n, 50)).toBeNull();
  });

  it('rejects a non-positive batch size', () => {
    expect(() => nextScanRange(0n, 10n, 0)).toThrow(RangeError);
  });
});
