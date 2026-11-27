/** Imported exclusively by /agent-console/demo. No wallet, network or private console state. */
import {
  commandRequestSchema, worldFrameV1Schema, type CommandRequest, type CommandRecord, type AgentLocation,
} from '@agent-republic/domain';
import {
  advanceCommandRecord, buildAgentObservation, makeCommandRecord, planCommand, withCommandOrigin, type CommandContext,
} from '@agent-republic/agent-engine';
import demoFrame from '../../../../examples/world-frame.demo.json';

const frame = worldFrameV1Schema.parse(demoFrame);
const ada = frame.society.agentSummaries.find((agent) => agent.displayName === 'Ada')!;
const borealis = frame.society.agentSummaries.find((agent) => agent.displayName === 'Borealis')!;
const observation = buildAgentObservation(frame, {
  owner: ada.owner, hasAgentId: true, registered: true, build: '100', rep: '0',
  blockNumber: frame.source.blockNumber, blockHash: frame.source.blockHash,
}, { networkBlockNumber: frame.source.blockNumber });
const context: CommandContext = {
  observation, profile: { agentId: ada.agentId, persona: 'COOPERATIVE', goal: 'EXPLORE_COALITIONS' },
  peers: [{ agentId: borealis.agentId, displayName: borealis.displayName, active: borealis.active, persona: 'PRAGMATIC' }],
};

export type DemoCommandState = { history: CommandRecord[]; location: AgentLocation };

export function submitDemoCommand(state: DemoCommandState, input: CommandRequest): DemoCommandState {
  const { history, location } = state;
  const parsed = commandRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error('Enter a command of 1–500 characters without credentials.');
  const request = parsed.data;
  const existing = history.find((record) => record.requestId === request.requestId);
  if (existing) {
    if (existing.text !== request.text || existing.mode !== request.mode) throw new Error('This request ID is already in use.');
    return state;
  }
  const now = new Date().toISOString();
  const record = withCommandOrigin(makeCommandRecord(request, planCommand(request, context), {
    id: crypto.randomUUID(), configVersion: 1, now, sourceBlock: observation.sourceBlock, worldFrameId: observation.worldFrameId,
  }), location);
  const active = history.find((entry) => entry.status === 'RUNNING');
  if (active && record.status === 'RUNNING' && record.mode !== 'INTERRUPT') {
    throw new Error('Ada has a task in progress. Choose Interrupt to pause it, or wait for the report.');
  }
  if (record.status === 'RUNNING' && history.filter((entry) => entry.status === 'PAUSED' || entry.status === 'RUNNING').length >= 8) {
    throw new Error('Finish a task before adding another interruption.');
  }
  const next = history.map((entry): CommandRecord => entry === active && record.status === 'RUNNING'
    ? { ...entry, status: 'PAUSED', revision: entry.revision + 1, updatedAt: now }
    : entry);
  // Keep all unfinished tasks, even when several declined requests arrive during an interruption.
  return { location, history: [record, ...next].filter((entry, index) => index < 50 || entry.status === 'RUNNING' || entry.status === 'PAUSED') };
}

export function advanceDemoCommands(state: DemoCommandState): DemoCommandState {
  const { history } = state;
  const active = history.find((entry) => entry.status === 'RUNNING');
  if (!active) return state;
  const now = new Date().toISOString();
  const next = advanceCommandRecord(withCommandOrigin(active, state.location), context, now);
  const step = next.steps[active.results.length];
  const location = step?.kind === 'VISIT' && next.status !== 'FAILED' ? step.location : state.location;
  const resume = next.status === 'RUNNING' ? undefined : history.find((entry) => entry.status === 'PAUSED');
  const updated = history.map((entry): CommandRecord => {
    if (entry === active) return next;
    if (entry === resume) return withCommandOrigin({ ...entry, status: 'RUNNING', revision: entry.revision + 1, updatedAt: now }, location);
    return entry;
  });
  return { history: updated, location };
}
