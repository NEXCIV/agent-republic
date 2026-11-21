import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { agentObservationV1Schema, worldFrameV1Schema } from '../src/index.js';

/**
 * E5-01 schema tests. The world frame is the contract between the indexer,
 * reducer, API, 3D renderer and agent runtime — every rejection here prevents
 * a whole class of "fake data looks like chain data" bugs.
 */

const fixturePath = fileURLToPath(new URL('../../../examples/world-frame.demo.json', import.meta.url));
const demoFrame = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(demoFrame)) as Record<string, unknown>;

/** Shallow typed access helper for mutation in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const at = (value: unknown): Record<string, any> => value as Record<string, any>;

describe('worldFrameV1Schema', () => {
  it('parses the DEMO fixture', () => {
    const parsed = worldFrameV1Schema.parse(demoFrame);
    expect(parsed.schemaVersion).toBe('1.1');
    expect(parsed.facts.projects[0]?.titleKey).toBe('GOLDEN_TOILET_TOWER');
    expect(parsed.simulation.agents).toHaveLength(2);
    expect(parsed.simulation.agents[0]?.isSimulated).toBe(true);
  });

  it('lowercases owner addresses during parsing', () => {
    const frame = clone();
    at(frame.society).agentSummaries[0].owner = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const parsed = worldFrameV1Schema.parse(frame);
    expect(parsed.society.agentSummaries[0]?.owner).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('rejects an unknown schema version', () => {
    const frame = clone();
    frame.schemaVersion = '1.0';
    expect(worldFrameV1Schema.safeParse(frame).success).toBe(false);
  });

  it('rejects unknown top-level fields instead of silently stripping them', () => {
    const frame = clone();
    at(frame).extraTruth = 'BUILD_CREDITED';
    expect(worldFrameV1Schema.safeParse(frame).success).toBe(false);
  });

  it('rejects a missing or malformed frameId', () => {
    const missing = clone();
    delete missing.frameId;
    expect(worldFrameV1Schema.safeParse(missing).success).toBe(false);

    const uppercase = clone();
    uppercase.frameId = `0x${'A'.repeat(64)}`;
    expect(worldFrameV1Schema.safeParse(uppercase).success).toBe(false);
  });

  it('rejects non-finite or out-of-district agent positions', () => {
    const nan = clone();
    at(nan.simulation).agents[0].position = [0, 0, Number.POSITIVE_INFINITY];
    expect(worldFrameV1Schema.safeParse(nan).success).toBe(false);

    const outside = clone();
    at(outside.simulation).agents[0].position = [25, 0, 0];
    expect(worldFrameV1Schema.safeParse(outside).success).toBe(false);
  });

  it('rejects simulation pretending to be a chain fact', () => {
    const frame = clone();
    at(frame.simulation).agents[0].isSimulated = false;
    expect(worldFrameV1Schema.safeParse(frame).success).toBe(false);
  });

  it('rejects unapproved or chain-labeled social messages', () => {
    const pending = clone();
    at(pending.society).publicMessages.push({
      id: 'm1',
      agentId: 'agent-01',
      owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      text: 'hello',
      createdAt: '2026-11-19T08:00:00.000Z',
      moderation: 'PENDING',
      provenance: 'AI_SIMULATED',
    });
    expect(worldFrameV1Schema.safeParse(pending).success).toBe(false);

    const chainLabeled = clone();
    at(chainLabeled.society).publicMessages.push({
      id: 'm2',
      agentId: 'agent-01',
      owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      text: 'hello',
      createdAt: '2026-11-19T08:00:00.000Z',
      moderation: 'APPROVED',
      provenance: 'CHAIN_CONFIRMED',
    });
    expect(worldFrameV1Schema.safeParse(chainLabeled).success).toBe(false);
  });

  it('caps public messages at 20', () => {
    const frame = clone();
    const messages = at(frame.society).publicMessages as unknown[];
    for (let index = 0; index < 21; index += 1) {
      messages.push({
        id: `m${index}`,
        agentId: 'agent-01',
        owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        text: `message ${index}`,
        createdAt: '2026-11-19T08:00:00.000Z',
        moderation: 'APPROVED',
        provenance: 'AI_SIMULATED',
      });
    }
    expect(worldFrameV1Schema.safeParse(frame).success).toBe(false);
  });

  it('caps visible agents at 30', () => {
    const frame = clone();
    const agents = at(frame.simulation).agents as unknown[];
    for (let index = 0; index < 29; index += 1) {
      agents.push({
        agentId: `agent-extra-${index}`,
        position: [0, 0, 0],
        facingRadians: 0,
        action: 'IDLE',
        locationId: 'PLAZA',
        isSimulated: true,
      });
    }
    expect(worldFrameV1Schema.safeParse(frame).success).toBe(false);
  });

  it('rejects duplicate agent ids and duplicate visual event ids', () => {
    const duplicateAgent = clone();
    at(duplicateAgent.simulation).agents[1].agentId = 'agent-01';
    expect(worldFrameV1Schema.safeParse(duplicateAgent).success).toBe(false);

    const duplicateEvent = clone();
    const event = {
      id: 'evt-1',
      kind: 'MOVE',
      targetId: 'agent-01',
      happenedAtTick: '0',
      sourceType: 'OFFCHAIN',
      sourceId: 'src-1',
    };
    at(duplicateEvent.simulation).visualEvents.push(event, { ...event });
    expect(worldFrameV1Schema.safeParse(duplicateEvent).success).toBe(false);
  });

  it('rejects negative counts and non-decimal chain amounts', () => {
    const negative = clone();
    at(negative.facts).citizenCount = -1;
    expect(worldFrameV1Schema.safeParse(negative).success).toBe(false);

    const floatAmount = clone();
    at(floatAmount.facts).projects[0].goalBuild = '2000.5';
    expect(worldFrameV1Schema.safeParse(floatAmount).success).toBe(false);
  });
});

describe('agentObservationV1Schema', () => {
  const observation = {
    worldFrameId: `0x${'11'.repeat(32)}`,
    sourceBlock: '70000000',
    epochId: 20776,
    facts: demoFrame.facts,
    self: {
      owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hasAgentId: true,
      registered: true,
      build: '100',
      rep: '2',
    },
    approvedPublicMessages: [],
    chainRecentEventIds: ['56:0xabc:0'],
  };

  it('parses a valid observation', () => {
    const parsed = agentObservationV1Schema.parse(observation);
    expect(parsed.self.build).toBe('100');
    expect(parsed.facts.citizenCount).toBe(2);
  });

  it('requires the frame id and a decimal source block', () => {
    expect(
      agentObservationV1Schema.safeParse({ ...observation, worldFrameId: 'frame-1' }).success,
    ).toBe(false);
    expect(
      agentObservationV1Schema.safeParse({ ...observation, sourceBlock: '70000.5' }).success,
    ).toBe(false);
  });

  it('rejects a private field smuggling attempt (strict object)', () => {
    expect(
      agentObservationV1Schema.safeParse({ ...observation, privatePrompt: 'system...' }).success,
    ).toBe(false);
  });

  it('rejects stats that are not decimal strings', () => {
    expect(
      agentObservationV1Schema.safeParse({
        ...observation,
        self: { ...observation.self, build: 100 },
      }).success,
    ).toBe(false);
  });
});
