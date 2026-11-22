import { buildAgentObservation, runDebate, type AgentProfile } from '@agent-republic/agent-engine';
import { PERSONAS, agentMemoryEntrySchema, worldFrameV1Schema } from '@agent-republic/domain';
import type { AgentMemoryEntry, DebateMessage } from '@agent-republic/domain';

export type DemoParticipant = AgentProfile & { readonly owner: string };

export type DemoResolution = {
  readonly status: 'COMPLETED' | 'DECLINED' | 'CANCELLED';
  readonly reason: string;
  readonly messages: readonly DebateMessage[];
  readonly memories: readonly AgentMemoryEntry[];
};

export function createDemoPair(frameInput: unknown) {
  const frame = worldFrameV1Schema.parse(frameInput);
  const summaries = frame.society.agentSummaries;
  const [first, second] = summaries;
  if (
    summaries.length !== 2 || !first || !second || first.owner === second.owner ||
    ![first, second].every((summary) => frame.simulation.agents.some(
      (agent) => agent.agentId === summary.agentId && agent.isSimulated,
    ))
  ) {
    throw new Error('DEMO requires two simulated citizens with distinct owners');
  }

  const profile = (summary: typeof first): DemoParticipant => {
    const persona = PERSONAS.find((value) => value === summary.persona);
    if (!persona) throw new Error('Unknown DEMO persona');
    return {
      agentId: summary.agentId,
      owner: summary.owner,
      persona,
      goal: persona === 'RULE_BASED' ? 'DEFEND_RULES' : 'BUILD_PUBLIC_GOODS',
    };
  };
  const pair = [profile(first), profile(second)] as const;

  const hasTopic = first.active && second.active && (
    frame.facts.projects.some((project) => project.status === 'FUNDING') ||
    frame.facts.proposals.some((proposal) => proposal.status === 'OPEN')
  );

  return {
    pair,
    hasTopic,
    resolve(id: string, inviter: DemoParticipant, recipient: DemoParticipant, recalled: boolean, now: Date): DemoResolution {
      if (!hasTopic || recipient.goal === 'DEFEND_RULES') {
        return {
          status: 'DECLINED',
          reason: hasTopic ? 'RECIPIENT_REQUIRES_VERIFIED_EVIDENCE' : 'NO_SHARED_TOPIC',
          messages: [],
          memories: [],
        };
      }
      // The demo actors have no chain permissions. Only synthetic civic topics
      // are passed to the same strict observation and debate path as the engine.
      const observation = buildAgentObservation(frame, {
        owner: inviter.owner,
        blockNumber: frame.source.blockNumber,
        blockHash: frame.source.blockHash,
        hasAgentId: false,
        registered: false,
        build: '0',
        rep: '0',
      }, { networkBlockNumber: frame.source.blockNumber });
      const { messages } = runDebate({
        threadId: id,
        participants: [inviter, recipient],
        maxRounds: recalled ? 1 : 2,
        observation,
        // Only deterministic engine templates using schema-validated numeric
        // facts enter this private demo. The moderation rule accepts no controls.
        moderate: (text) => text.length <= 500 && [...text].every((char) => char >= ' ' && char !== '\u007f')
          ? 'APPROVED'
          : 'REJECTED',
      });
      if (messages.length !== (recalled ? 2 : 4)) {
        return { status: 'CANCELLED', reason: 'DISCUSSION_REJECTED', messages: [], memories: [] };
      }
      const sourceIds = messages.map((message) => `${message.threadId}:${message.turnIndex}`);
      const memories = [inviter, recipient].map((participant) => agentMemoryEntrySchema.parse({
        id: `${id}:${participant.agentId}`,
        agentId: participant.agentId,
        kind: 'SOCIAL',
        text: 'DEMO: discussed a shared civic topic and recorded each participant’s position.',
        sourceIds,
        createdAt: now.toISOString(),
        agentConfigVersion: 1,
        confidenceLabel: 'SOCIAL_APPROVED',
      }));
      return {
        status: 'COMPLETED',
        reason: recalled ? 'ACCEPTED_AFTER_RECALL' : 'ACCEPTED',
        messages,
        memories,
      };
    },
  };
}
