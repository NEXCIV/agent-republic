import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentObservationV1 } from '@agent-republic/domain';
import {
  AGENT_DAILY_LIMITS,
  LlmBudgetError,
  LlmBudgetGuard,
  buildPlannerPrompts,
  estimateTokens,
  planWithProvider,
  spendBudget,
  withLlmBudget,
  type PlannerModelProvider,
} from '../../packages/agent-engine/src/index.js';
import {
  MAX_AGENTS_PER_STEP,
  initialAgentStates,
  stepSimulation,
  toSimAgentStates,
} from '../../packages/world-engine/src/index.js';

/**
 * E7-03 — 30-agent scale and cost stress.
 *
 * Proves two invariants from docs/AGENT_ENGINE.md §11/§15:
 *  1. a full 30-agent day (1 decision + 4 replies + 1 reflection each) fits a
 *     hard USD cap, and a tighter cap is refused before the provider is called;
 *  2. the 60-second visual tick runs 60 times with 30 agents without any LLM,
 *     network or agent-engine dependency.
 *
 * Prices and the "model" are synthetic; no real provider is contacted.
 */

const owner = (index: number): string => `0x${index.toString(16).padStart(40, '0')}`;

const MODEL = 'stress-model';
const PRICE = { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 1.5 };
const EPOCH = 20_777;
const MICROS = 1_000_000;

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

const provider: PlannerModelProvider = { async complete() { return validOutput; } };

function observationFor(ownerAddress: string): AgentObservationV1 {
  return {
    worldFrameId: `0x${'11'.repeat(32)}`,
    sourceBlock: '1000',
    epochId: EPOCH,
    facts: {
      citizenCount: 30,
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
      owner: ownerAddress,
      hasAgentId: true,
      registered: true,
      build: '100',
      rep: '0',
    },
    approvedPublicMessages: [],
    chainRecentEventIds: [],
  };
}

const agentIds = Array.from({ length: 30 }, (_, index) => `agent-${String(index + 1).padStart(2, '0')}`);
const agentOwners = agentIds.map((_, index) => owner(index + 1));

describe('E7-03 30-agent cost stress', () => {
  it('runs a full 30-agent day inside the hard cap', async () => {
    const guard = new LlmBudgetGuard({
      dailyCostLimitUsd: 0.5,
      prices: { [MODEL]: PRICE },
    });

    for (let index = 0; index < agentIds.length; index += 1) {
      const agentId = agentIds[index]!;
      const observation = observationFor(agentOwners[index]!);
      const profile = { agentId, persona: 'PRAGMATIC' as const, goal: 'BUILD_PUBLIC_GOODS' as const };
      const wrapped = withLlmBudget(provider, guard, { agentId, epochId: EPOCH, model: MODEL });

      const result = await planWithProvider({ observation, profile }, wrapped);
      expect(result.source).toBe('MODEL');

      const context = { agentId, epochId: EPOCH };
      for (let reply = 0; reply < AGENT_DAILY_LIMITS.DEBATE_REPLY.calls; reply += 1) {
        spendBudget(guard, 'DEBATE_REPLY', context, MODEL, 700, 250);
      }
      spendBudget(guard, 'REFLECTION', context, MODEL, 1000, 300);

      expect(guard.callsFor(agentId)).toEqual({ MAIN_DECISION: 1, DEBATE_REPLY: 4, REFLECTION: 1 });
    }

    const snapshot = guard.snapshot();
    expect(snapshot.calls).toEqual({ MAIN_DECISION: 30, DEBATE_REPLY: 120, REFLECTION: 30 });
    expect(snapshot.reservedUsd).toBe(0);
    expect(snapshot.hardCapBreached).toBe(false);
    expect(snapshot.spentUsd).toBeGreaterThan(0);
    expect(snapshot.spentUsd).toBeLessThanOrEqual(snapshot.limitUsd);
    expect(snapshot.denied).toMatchObject({
      DAILY_LIMIT: 0,
      AGENT_DAILY_LIMIT: 0,
      OPTIONAL_PAUSED: 0,
    });

    // Exact expected spend: the prompt is deterministic and identical in
    // length for every agent (same address/agent-id widths).
    const prompts = buildPlannerPrompts(
      { agentId: agentIds[0]!, persona: 'PRAGMATIC', goal: 'BUILD_PUBLIC_GOODS' },
      observationFor(agentOwners[0]!),
    );
    const mainIn = estimateTokens(`${prompts.system}\n${prompts.user}`);
    const mainOut = estimateTokens(validOutput);
    const mainCost = Math.ceil(mainIn * PRICE.inputUsdPerMillionTokens) + Math.ceil(mainOut * PRICE.outputUsdPerMillionTokens);
    const debateCost = Math.ceil(700 * PRICE.inputUsdPerMillionTokens) + Math.ceil(250 * PRICE.outputUsdPerMillionTokens);
    const reflectionCost =
      Math.ceil(1000 * PRICE.inputUsdPerMillionTokens) + Math.ceil(300 * PRICE.outputUsdPerMillionTokens);
    const expectedMicros = 30 * (mainCost + 4 * debateCost + reflectionCost);
    expect(Math.round(snapshot.spentUsd * MICROS)).toBe(expectedMicros);
  });

  it('refuses calls instead of overspending a tight cap', () => {
    const guard = new LlmBudgetGuard({
      dailyCostLimitUsd: 0.03,
      prices: { [MODEL]: PRICE },
    });

    let allowed = 0;
    let denied = 0;
    const attempt = (agentId: string, kind: 'MAIN_DECISION' | 'DEBATE_REPLY' | 'REFLECTION'): void => {
      try {
        const limits = AGENT_DAILY_LIMITS[kind];
        spendBudget(guard, kind, { agentId, epochId: EPOCH }, MODEL, limits.inputTokens, limits.outputTokens);
        allowed += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(LlmBudgetError);
        denied += 1;
      }
    };

    for (const agentId of agentIds) {
      attempt(agentId, 'MAIN_DECISION');
      for (let reply = 0; reply < AGENT_DAILY_LIMITS.DEBATE_REPLY.calls; reply += 1) {
        attempt(agentId, 'DEBATE_REPLY');
      }
      attempt(agentId, 'REFLECTION');
    }

    const snapshot = guard.snapshot();
    expect(denied).toBeGreaterThan(0);
    expect(allowed).toBeGreaterThan(0);
    expect(snapshot.denied.DAILY_LIMIT).toBeGreaterThan(0);
    expect(snapshot.spentUsd).toBeLessThanOrEqual(snapshot.limitUsd);
    expect(snapshot.reservedUsd).toBe(0);
    expect(snapshot.hardCapBreached).toBe(false);
  });
});

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const TICK_SOURCE_DIRS = [
  path.join(ROOT, 'packages', 'world-engine', 'src'),
  path.join(ROOT, 'apps', 'worker', 'src', 'world'),
];
const LLM_PATTERN = /@agent-republic\/agent-engine|\bopenai\b|\banthropic\b|@langchain|langchain|@google\/generative|\bfetch\(|\baxios\b|node:http|node:https/;

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('E7-03 60-second tick independence', () => {
  it('has no LLM or agent-engine dependency in the world tick path', () => {
    for (const directory of TICK_SOURCE_DIRS) {
      for (const file of sourceFiles(directory)) {
        const source = readFileSync(file, 'utf8');
        expect(source, `${path.relative(ROOT, file)} must not reference an LLM`).not.toMatch(LLM_PATTERN);
      }
    }

    const worldPackage = JSON.parse(
      readFileSync(path.join(ROOT, 'packages', 'world-engine', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(worldPackage.dependencies ?? {})).toEqual(['@agent-republic/domain']);
  });

  it('runs 60 ticks with 30 agents without any network call', () => {
    let states = initialAgentStates({ worldSeed: 'e7-03-scale', agentIds });
    expect(states).toHaveLength(MAX_AGENTS_PER_STEP);
    expect(states).toHaveLength(30);

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('the world tick must never use the network');
    }) as typeof fetch;

    try {
      for (let tick = 0; tick < 60; tick += 1) {
        const step = stepSimulation({ worldSeed: 'e7-03-scale', tick: BigInt(tick), agents: states });
        expect(step.agents.length).toBeLessThanOrEqual(30);
        for (const event of step.visualEvents) {
          expect(['CHAIN', 'OFFCHAIN']).toContain(event.sourceType);
        }
        states = toSimAgentStates(step.agents);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchCalls).toBe(0);
    expect(states).toHaveLength(30);
  });
});
