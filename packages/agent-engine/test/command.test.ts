import { describe, expect, it } from 'vitest';
import { commandRequestSchema, type AgentObservationV1, type CommandRequest } from '@agent-republic/domain';
import { performCommandStep, planCommand, withCommandOrigin, type CommandContext } from '../src/command.js';
import { makeCommandRecord } from '../src/command-journal.js';

const request = (text: string, mode: CommandRequest['mode'] = 'EXECUTE'): CommandRequest => ({
  text, mode, requestId: 'b85640ab-a156-495a-a977-ca5acac2b9db',
});
const observation: AgentObservationV1 = {
  worldFrameId: `0x${'a'.repeat(64)}`, sourceBlock: '32', epochId: 0,
  facts: {
    citizenCount: 2, proposals: [],
    projects: [{ id: '1', titleKey: 'tower', goalBuild: '2000', fundedBuild: '20', status: 'FUNDING', completedAtBlock: null }],
  },
  self: { owner: `0x${'b'.repeat(40)}`, registered: true, hasAgentId: true, build: '100', rep: '0' },
  approvedPublicMessages: [], chainRecentEventIds: [],
  publicContacts: [{ agentId: 'agent-02', displayName: 'Borealis' }],
};
const context: CommandContext = {
  profile: { agentId: 'agent-01', persona: 'COOPERATIVE', goal: 'BUILD_PUBLIC_GOODS' },
  peers: [{ agentId: 'agent-02', displayName: 'Borealis', active: true, persona: 'PRAGMATIC', goal: 'BUILD_PUBLIC_GOODS' }],
  observation,
};

describe('personal command planning', () => {
  it('rejects caller-supplied identity, embedded authority and wallet credentials', () => {
    const valid = request('Visit the plaza');
    expect(commandRequestSchema.safeParse({ ...valid, owner: observation.self.owner }).success).toBe(false);
    expect(commandRequestSchema.safeParse({ ...valid, steps: [{ kind: 'VOTE' }] }).success).toBe(false);
    expect(commandRequestSchema.safeParse(request('my private key is ' + 'ef'.repeat(32))).success).toBe(false);
    expect(commandRequestSchema.safeParse(request('  ')).success).toBe(false);
  });

  it.each(['去中央广场，然后替我投票', 'Review project 1 then transfer 4 BNB', 'Go to Mars', 'Make a cake', 'Find Nova.ai and discuss the project', 'Talk to BorealisXYZ'])('rejects the whole unsupported instruction "%s"', (text) => {
    expect(planCommand(request(text), context)).toMatchObject({ decline: expect.any(String), steps: [] });
  });

  it('limits recipients to contacts visible to this agent and rechecks availability at execution', () => {
    const hidden = { ...context, observation: { ...observation, publicContacts: [] } };
    expect(planCommand(request('Talk to Borealis'), hidden).decline).toBeTruthy();
    const step = { kind: 'DISCUSS', targetAgentId: 'agent-02' } as const;
    expect(performCommandStep(step, hidden, []).failed).toBe(true);
    expect(performCommandStep(step, { ...context, peers: context.peers.map((peer) => ({ ...peer, active: false })) }, []).failed).toBe(true);
  });

  it('lets the recipient withhold cooperation independently of the command mode', () => {
    const cautious: CommandContext = { ...context, peers: context.peers.map((peer) => ({ ...peer, persona: 'RULE_BASED' })) };
    const step = { kind: 'DISCUSS', targetAgentId: 'agent-02' } as const;
    expect(performCommandStep(step, cautious, []).result).toMatch(/declined/i);
    expect(performCommandStep(step, context, []).result).toMatch(/20 of 2000/);
  });

  it.each(['去中央广场找 Borealis，和它聊一下建设项目，然后回来告诉我。', 'Go to Central Plaza, find Borealis and discuss the construction project, then report back.'])('plans and reports a visit and private discussion in order', (text) => {
    const plan = planCommand(request(text), context);
    expect(plan.decline).toBeNull();
    expect(plan.steps[0]).toEqual({ kind: 'VISIT', location: 'PLAZA' });
    expect(plan.steps.some((step) => step.kind === 'DISCUSS' && step.targetAgentId === 'agent-02')).toBe(true);
    expect(plan.steps.at(-1)).toEqual({ kind: 'REPORT' });
    const results: string[] = [];
    for (const step of plan.steps) {
      const output = performCommandStep(step, context, results);
      expect(output.failed).toBe(false);
      results.push(output.result);
    }
    expect(results.at(-1)).toContain('Borealis');
    expect(results.at(-1)).toContain('block 32');
  });

  it('uses observed facts, filters an explicit project and preserves the observation block', () => {
    const first = planCommand(request('Review project #1'), context).steps[0]!;
    expect(first).toMatchObject({ kind: 'REVIEW', subject: 'PROJECTS' });
    expect(performCommandStep(first, context, []).result).toContain('20 of 2000');
    const missing = planCommand(request('Review project #99'), context);
    expect(missing.decline).toBeTruthy();
    const council = planCommand(request('帮我了解当前治理提案'), context);
    expect(performCommandStep(council.steps[0]!, context, []).result).toMatch(/no proposals/i);
  });

  it('allows persona to decline a suggestion while an executable instruction takes priority', () => {
    const director: CommandContext = { ...context, profile: { ...context.profile, goal: 'DEFEND_RULES' } };
    expect(planCommand(request('Explore the city', 'SUGGEST'), director).decline).toBeTruthy();
    expect(planCommand(request('Explore the city', 'EXECUTE'), director).decline).toBeNull();
  });

  it.each(['Make a cake for the project', 'Go to Mars, then review project #1', '去中央广场，顺便买个蛋糕', 'Do not go to the plaza', 'Review project 1 in three days'])('declines partial, negated or deferred plans: %s', (text) => {
    expect(planCommand(request(text), context).steps).toEqual([]);
  });

  it('keeps the requested activity order and routes to an entrance over the scene graph', () => {
    const plan = planCommand(request('Review project #1, then visit Council Hall, then go to the Agent Core'), context);
    expect(plan.steps.map((step) => step.kind)).toEqual(['REVIEW', 'VISIT', 'VISIT', 'REPORT']);
    const secondTrip = performCommandStep(plan.steps[2]!, context, []);
    expect(secondTrip.result).toMatch(/P9 → P1/);
    expect(secondTrip.result).toContain('P12');
  });

  it('rebases only the unfinished itinerary after returning from an interrupt', () => {
    const input = request('Visit Council Hall, then go to the Agent Core, then visit the plaza');
    const record = makeCommandRecord(input, planCommand(input, context), {
      id: input.requestId, configVersion: 1, sourceBlock: '32', worldFrameId: observation.worldFrameId,
      now: '2026-11-20T00:00:00.000Z',
    });
    const firstTripDone = { ...record, results: ['Arrived at Council Hall'] };
    const resumed = withCommandOrigin(firstTripDone, 'PROJECT');
    expect(resumed.steps).toEqual([
      { kind: 'VISIT', location: 'COUNCIL' },
      { kind: 'VISIT', location: 'CORE', from: 'PROJECT' },
      { kind: 'VISIT', location: 'PLAZA', from: 'CORE' },
      { kind: 'REPORT' },
    ]);
    expect(firstTripDone.steps[1]).toHaveProperty('from', 'COUNCIL');
    expect(withCommandOrigin(record, 'IDENTITY').steps[0]).toHaveProperty('from', 'IDENTITY');
  });
});
