import { describe, expect, it } from 'vitest';
import type { AgentObservationV1 } from '@agent-republic/domain';
import {
  AGENT_DAILY_LIMITS,
  LlmBudgetError,
  LlmBudgetGuard,
  planWithProvider,
  spendBudget,
  withLlmBudget,
  type BudgetedPlannerOptions,
  type LlmBudgetConfig,
  type PlannerModelProvider,
} from '../src/index.js';

/**
 * E7-03 — hard budget guard unit tests (docs/AGENT_ENGINE.md §11).
 * Prices are synthetic test values; no real model is called.
 */

const OWNER = `0x${'ab'.repeat(20)}`;
const MODEL = 'test-model';
const PRICE = { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 1.5 };
const EPOCH = 20_777;

const config = (overrides: Partial<LlmBudgetConfig> = {}): LlmBudgetConfig => ({
  dailyCostLimitUsd: 0.5,
  prices: { [MODEL]: PRICE },
  ...overrides,
});

const observation: AgentObservationV1 = {
  worldFrameId: `0x${'11'.repeat(32)}`,
  sourceBlock: '1000',
  epochId: EPOCH,
  facts: {
    citizenCount: 1,
    projects: [
      {
        id: '1',
        titleKey: 'golden-toilet-tower',
        goalBuild: '2000',
        fundedBuild: '480',
        status: 'FUNDING',
        completedAtBlock: null,
      },
    ],
    proposals: [],
  },
  self: {
    owner: OWNER,
    hasAgentId: true,
    registered: true,
    build: '100',
    rep: '0',
  },
  approvedPublicMessages: [],
  chainRecentEventIds: [],
};

const profile = { agentId: 'agent-1', persona: 'PRAGMATIC' as const, goal: 'BUILD_PUBLIC_GOODS' as const };

const validOutput = JSON.stringify({
  schemaVersion: '1.0',
  intent: 'ABSTAIN',
  targetType: 'NONE',
  targetId: null,
  choice: null,
  buildAmount: null,
  publicMessage: '',
  rationale: 'No action.',
  evidenceEventIds: [],
  confidenceSelfReport: 0.2,
  requiresOwnerApproval: false,
});

const micros = (usd: number): number => Math.round(usd * 1_000_000);

describe('LlmBudgetGuard quotas', () => {
  it('allows one main decision, four replies and one reflection per agent', () => {
    const guard = new LlmBudgetGuard(config());
    const ctx = { agentId: 'agent-1', epochId: EPOCH };

    spendBudget(guard, 'MAIN_DECISION', ctx, MODEL, 1200, 500);
    for (let index = 0; index < AGENT_DAILY_LIMITS.DEBATE_REPLY.calls; index += 1) {
      spendBudget(guard, 'DEBATE_REPLY', ctx, MODEL, 700, 250);
    }
    spendBudget(guard, 'REFLECTION', ctx, MODEL, 1000, 300);

    expect(guard.callsFor('agent-1')).toEqual({ MAIN_DECISION: 1, DEBATE_REPLY: 4, REFLECTION: 1 });
    expect(guard.snapshot().denied.AGENT_DAILY_LIMIT).toBe(0);
  });

  it('rejects a second main decision and a fifth debate reply', () => {
    const guard = new LlmBudgetGuard(config());
    const ctx = { agentId: 'agent-1', epochId: EPOCH };
    spendBudget(guard, 'MAIN_DECISION', ctx, MODEL, 1000, 400);
    for (let index = 0; index < 4; index += 1) {
      spendBudget(guard, 'DEBATE_REPLY', ctx, MODEL, 600, 200);
    }

    expect(() => spendBudget(guard, 'MAIN_DECISION', ctx, MODEL, 1000, 400)).toThrowError(
      expect.objectContaining({ code: 'AGENT_DAILY_LIMIT' }),
    );
    expect(() => spendBudget(guard, 'DEBATE_REPLY', ctx, MODEL, 600, 200)).toThrowError(
      expect.objectContaining({ code: 'AGENT_DAILY_LIMIT' }),
    );
    expect(guard.snapshot().reservedUsd).toBe(0);
  });

  it('rejects an oversized input before reserving budget', () => {
    const guard = new LlmBudgetGuard(config());
    expect(() =>
      spendBudget(guard, 'MAIN_DECISION', { agentId: 'agent-1', epochId: EPOCH }, MODEL, 1201, 100),
    ).toThrowError(expect.objectContaining({ code: 'INPUT_TOO_LARGE' }));
    expect(guard.snapshot()).toMatchObject({ spentUsd: 0, reservedUsd: 0 });
  });

  it('rejects an unknown model price', () => {
    const guard = new LlmBudgetGuard(config());
    expect(() =>
      spendBudget(guard, 'MAIN_DECISION', { agentId: 'agent-1', epochId: EPOCH }, 'unknown-model', 10, 10),
    ).toThrowError(expect.objectContaining({ code: 'PRICE_UNKNOWN' }));
  });
});

describe('LlmBudgetGuard hard cap', () => {
  it('refuses a call whose worst-case reservation exceeds the cap', () => {
    // Main decision worst case = 1200 * 0.5 + 500 * 1.5 = 1350 micro-USD.
    const guard = new LlmBudgetGuard(config({ dailyCostLimitUsd: 0.001 }));
    expect(() =>
      spendBudget(guard, 'MAIN_DECISION', { agentId: 'agent-1', epochId: EPOCH }, MODEL, 1200, 500),
    ).toThrowError(expect.objectContaining({ code: 'DAILY_LIMIT' }));

    const snapshot = guard.snapshot();
    expect(snapshot.spentUsd).toBe(0);
    expect(snapshot.denied.DAILY_LIMIT).toBe(1);
    expect(snapshot.hardCapBreached).toBe(false);
  });

  it('never spends above the cap across many agents', () => {
    const guard = new LlmBudgetGuard(config({ dailyCostLimitUsd: 0.002 }));
    let allowed = 0;
    let denied = 0;
    for (let index = 0; index < 10; index += 1) {
      try {
        spendBudget(
          guard,
          'MAIN_DECISION',
          { agentId: `agent-${index}`, epochId: EPOCH },
          MODEL,
          1200,
          500,
        );
        allowed += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(LlmBudgetError);
        denied += 1;
      }
    }

    const snapshot = guard.snapshot();
    expect(allowed).toBe(1);
    expect(denied).toBe(9);
    expect(micros(snapshot.spentUsd)).toBe(1350);
    expect(micros(snapshot.spentUsd)).toBeLessThanOrEqual(micros(snapshot.limitUsd));
    expect(snapshot.reservedUsd).toBe(0);
  });

  it('counts pre-existing spend loaded from the usage ledger', () => {
    const guard = new LlmBudgetGuard(config({ dailyCostLimitUsd: 0.002, initialSpentUsd: 0.0015 }));
    expect(() =>
      spendBudget(guard, 'MAIN_DECISION', { agentId: 'agent-1', epochId: EPOCH }, MODEL, 1200, 500),
    ).toThrowError(expect.objectContaining({ code: 'DAILY_LIMIT' }));
    expect(guard.snapshot().spentUsd).toBeCloseTo(0.0015, 8);
  });
});

describe('LlmBudgetGuard optional discussion pause', () => {
  it('stops debate replies near the cap while owner decisions continue', () => {
    const guard = new LlmBudgetGuard(config({ dailyCostLimitUsd: 0.1, optionalStopRatio: 0.8 }));
    let agentIndex = 0;
    while (!guard.optionalPaused) {
      const ctx = { agentId: `agent-${agentIndex}`, epochId: EPOCH };
      for (let reply = 0; reply < 4; reply += 1) {
        if (guard.optionalPaused) break;
        spendBudget(guard, 'DEBATE_REPLY', ctx, MODEL, 700, 250);
      }
      agentIndex += 1;
      if (agentIndex > 100) throw new Error('optional pause never triggered');
    }
    expect(guard.optionalPaused).toBe(true);

    expect(() =>
      spendBudget(guard, 'DEBATE_REPLY', { agentId: 'fresh-agent', epochId: EPOCH }, MODEL, 700, 250),
    ).toThrowError(expect.objectContaining({ code: 'OPTIONAL_PAUSED' }));

    // Main decisions remain possible until the hard ceiling.
    spendBudget(guard, 'MAIN_DECISION', { agentId: 'fresh-agent', epochId: EPOCH }, MODEL, 1200, 500);
    expect(guard.callsFor('fresh-agent')).toMatchObject({ MAIN_DECISION: 1, DEBATE_REPLY: 0 });
  });
});

describe('LlmBudgetGuard epoch rollover', () => {
  it('resets quotas and spend for a new epoch', () => {
    const guard = new LlmBudgetGuard(config({ dailyCostLimitUsd: 0.002 }));
    spendBudget(guard, 'MAIN_DECISION', { agentId: 'agent-1', epochId: EPOCH }, MODEL, 1200, 500);
    expect(guard.snapshot().spentUsd).toBeGreaterThan(0);

    spendBudget(guard, 'MAIN_DECISION', { agentId: 'agent-1', epochId: EPOCH + 1 }, MODEL, 1200, 500);
    const snapshot = guard.snapshot();
    expect(snapshot.epochId).toBe(EPOCH + 1);
    expect(snapshot.calls).toEqual({ MAIN_DECISION: 1, DEBATE_REPLY: 0, REFLECTION: 0 });
    expect(micros(snapshot.spentUsd)).toBe(1350);
    expect(snapshot.denied.AGENT_DAILY_LIMIT).toBe(0);
  });
});

describe('withLlmBudget provider wrapper', () => {
  const options: BudgetedPlannerOptions = {
    agentId: 'agent-1',
    epochId: EPOCH,
    model: MODEL,
  };

  it('records usage and keeps planWithProvider working', async () => {
    const guard = new LlmBudgetGuard(config());
    const usages: unknown[] = [];
    const provider: PlannerModelProvider = { async complete() { return validOutput; } };
    const wrapped = withLlmBudget(provider, guard, {
      ...options,
      onUsage: (usage) => usages.push(usage),
    });

    const result = await planWithProvider({ observation, profile }, wrapped);
    expect(result.source).toBe('MODEL');
    expect(usages).toHaveLength(1);
    const snapshot = guard.snapshot();
    expect(snapshot.calls.MAIN_DECISION).toBe(1);
    expect(snapshot.spentUsd).toBeGreaterThan(0);
    expect(snapshot.reservedUsd).toBe(0);
  });

  it('turns a denied call into an abstention without spending', async () => {
    const guard = new LlmBudgetGuard(config());
    spendBudget(guard, 'MAIN_DECISION', { agentId: 'agent-1', epochId: EPOCH }, MODEL, 1200, 500);
    const spentBefore = guard.snapshot().spentUsd;

    const provider: PlannerModelProvider = { async complete() { return validOutput; } };
    const result = await planWithProvider(
      { observation, profile },
      withLlmBudget(provider, guard, options),
    );
    expect(result.source).toBe('ABSTAIN_FALLBACK');
    expect(result.action.intent).toBe('ABSTAIN');
    expect(guard.snapshot().spentUsd).toBe(spentBefore);
    expect(guard.snapshot().denied.AGENT_DAILY_LIMIT).toBe(1);
  });

  it('releases the reservation when the provider fails', async () => {
    const guard = new LlmBudgetGuard(config());
    const provider: PlannerModelProvider = {
      async complete() {
        throw new Error('timeout');
      },
    };
    const result = await planWithProvider(
      { observation, profile },
      withLlmBudget(provider, guard, options),
    );
    expect(result.source).toBe('ABSTAIN_FALLBACK');
    const snapshot = guard.snapshot();
    expect(snapshot.spentUsd).toBe(0);
    expect(snapshot.reservedUsd).toBe(0);
    expect(snapshot.calls.MAIN_DECISION).toBe(1);
  });
});
