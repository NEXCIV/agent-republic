import { GOALS, PERSONAS, agentObservationV1Schema, debateMessageSchema } from '@agent-republic/domain';
import type {
  AgentObservationV1,
  DebateCondition,
  DebateMessage,
  DebateStance,
} from '@agent-republic/domain';
import type { AgentProfile } from './persona.js';
import type { ModerationVerdict } from './policy.js';

/**
 * E3-05 — two-agent, limited-round public negotiation.
 *
 * The engine lets exactly two configured agents exchange at most one message
 * per round for at most two rounds. Every line is deterministic, grounded in
 * the observation block, moderated before publication and stored with
 * provenance AI_SIMULATED. It never creates an on-chain action, transfers
 * assets or treats negotiation promises as votes.
 */

export type DebateStopReason = 'COMPLETED' | 'MODERATION_UNAVAILABLE';

export type DebateInput = {
  readonly threadId: string;
  readonly observation: AgentObservationV1;
  readonly participants: readonly [AgentProfile, AgentProfile];
  readonly maxRounds?: number;
  readonly moderate: (text: string) => ModerationVerdict;
};

export type DebateResult = {
  readonly messages: DebateMessage[];
  readonly rejected: number;
  readonly stoppedReason: DebateStopReason;
};

export type DebateErrorCode = 'INVALID_INPUT' | 'NO_TOPIC' | 'INVALID_MESSAGE';

export class DebateError extends Error {
  readonly code: DebateErrorCode;

  constructor(code: DebateErrorCode, message: string) {
    super(`[agent-debate] ${message}`);
    this.name = 'DebateError';
    this.code = code;
  }
}

type Topic =
  | {
      readonly kind: 'PROJECT';
      readonly id: string;
      readonly funded: string;
      readonly goal: string;
      readonly remaining: string;
    }
  | { readonly kind: 'PROPOSAL'; readonly id: string; readonly status: string };

type Draft = {
  readonly stance: DebateStance;
  readonly condition: DebateCondition;
  readonly text: string;
};

function validateInput(input: DebateInput): {
  observation: AgentObservationV1;
  participants: readonly [AgentProfile, AgentProfile];
  maxRounds: number;
} {
  const parsed = agentObservationV1Schema.safeParse(input.observation);
  if (!parsed.success) throw new DebateError('INVALID_INPUT', 'observation is invalid');

  if (typeof input.threadId !== 'string' || input.threadId.length === 0 || input.threadId.length > 96) {
    throw new DebateError('INVALID_INPUT', 'threadId must be 1..96 characters');
  }
  if (!Array.isArray(input.participants) || input.participants.length !== 2) {
    throw new DebateError('INVALID_INPUT', 'exactly two participants are required');
  }

  const [first, second] = input.participants;
  for (const profile of [first, second]) {
    if (
      profile === undefined ||
      typeof profile.agentId !== 'string' ||
      profile.agentId.length === 0 ||
      profile.agentId.length > 64
    ) {
      throw new DebateError('INVALID_INPUT', 'participant agentId is invalid');
    }
    if (!(PERSONAS as readonly string[]).includes(profile.persona)) {
      throw new DebateError('INVALID_INPUT', 'participant persona is invalid');
    }
    if (!(GOALS as readonly string[]).includes(profile.goal)) {
      throw new DebateError('INVALID_INPUT', 'participant goal is invalid');
    }
  }
  if (first === undefined || second === undefined || first.agentId === second.agentId) {
    throw new DebateError('INVALID_INPUT', 'participants must have distinct agentIds');
  }

  const maxRounds = input.maxRounds ?? 2;
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 2) {
    throw new DebateError('INVALID_INPUT', 'maxRounds must be 1 or 2');
  }
  if (typeof input.moderate !== 'function') {
    throw new DebateError('INVALID_INPUT', 'a moderation function is required');
  }

  return { observation: parsed.data, participants: [first, second], maxRounds };
}

function chooseTopic(observation: AgentObservationV1): Topic | null {
  const project = observation.facts.projects.find((entry) => entry.status === 'FUNDING');
  if (project !== undefined) {
    const remaining = BigInt(project.goalBuild) - BigInt(project.fundedBuild);
    return {
      kind: 'PROJECT',
      id: project.id,
      funded: project.fundedBuild,
      goal: project.goalBuild,
      remaining: remaining > 0n ? remaining.toString() : '0',
    };
  }

  const proposal = observation.facts.proposals.find((entry) => entry.status === 'OPEN');
  if (proposal !== undefined) {
    return { kind: 'PROPOSAL', id: proposal.id, status: proposal.status };
  }
  return null;
}

const condition = (kind: DebateCondition['kind'], value: string | null): DebateCondition => ({
  kind,
  value,
});

function firstDraft(persona: AgentProfile['persona'], topic: Topic, block: string): Draft {
  if (topic.kind === 'PROJECT') {
    const facts = `Project #${topic.id}: ${topic.funded} of ${topic.goal} BUILD confirmed (${topic.remaining} remaining), block ${block}.`;
    switch (persona) {
      case 'PRAGMATIC':
        return { stance: 'SUPPORT', condition: condition('MIN_PROGRESS', topic.funded), text: `I support moving forward. ${facts}` };
      case 'COMPETITIVE':
        return {
          stance: 'SUPPORT',
          condition: condition('MIN_PROGRESS', topic.funded),
          text: `I support progress tied to verifiable on-chain contributions. ${facts}`,
        };
      case 'COOPERATIVE':
        return {
          stance: 'CONDITIONAL',
          condition: condition('MIN_SUPPORT', '3'),
          text: `I will support project #${topic.id} if at least three citizens publicly commit. ${facts}`,
        };
      case 'RULE_BASED':
        return {
          stance: 'CONDITIONAL',
          condition: condition('MIN_PROGRESS', topic.funded),
          text: `I will support only after confirmed progress evidence is published. ${facts}`,
        };
    }
  }

  const facts = `Proposal #${topic.id} is ${topic.status}, block ${block}.`;
  switch (persona) {
    case 'PRAGMATIC':
      return { stance: 'SUPPORT', condition: condition('NONE', null), text: `I support considering this proposal on its merits. ${facts}` };
    case 'COMPETITIVE':
      return { stance: 'CONDITIONAL', condition: condition('MIN_SUPPORT', '3'), text: `I support this proposal if at least three citizens publicly commit. ${facts}` };
    case 'COOPERATIVE':
      return { stance: 'CONDITIONAL', condition: condition('MIN_SUPPORT', '3'), text: `I am open to supporting this proposal with at least three public commitments. ${facts}` };
    case 'RULE_BASED':
      return { stance: 'CONDITIONAL', condition: condition('NONE', null), text: `I require published evidence before supporting this proposal. ${facts}` };
  }
  throw new DebateError('INVALID_MESSAGE', 'unsupported persona');
}

function replyDraft(
  persona: AgentProfile['persona'],
  topic: Topic,
  block: string,
  opponentStance: DebateStance,
): Draft {
  const facts =
    topic.kind === 'PROJECT'
      ? `Project #${topic.id}: ${topic.funded} of ${topic.goal} BUILD confirmed (${topic.remaining} remaining), block ${block}.`
      : `Proposal #${topic.id} is ${topic.status}, block ${block}.`;

  if (persona === 'COOPERATIVE') {
    return {
      stance: 'CONDITIONAL',
      condition: condition('MIN_SUPPORT', '3'),
      text: `I can move toward support if at least three citizens commit. ${facts}`,
    };
  }
  if (persona === 'RULE_BASED') {
    return {
      stance: 'CONDITIONAL',
      condition:
        topic.kind === 'PROJECT'
          ? condition('MIN_PROGRESS', topic.funded)
          : condition('NONE', null),
      text: `I acknowledge your ${opponentStance.toLowerCase()} position. Support stays conditional on confirmed evidence. ${facts}`,
    };
  }
  if (opponentStance === 'OPPOSE') {
    return {
      stance: persona === 'COMPETITIVE' ? 'CONDITIONAL' : 'NEUTRAL',
      condition:
        persona === 'COMPETITIVE' && topic.kind === 'PROJECT'
          ? condition('MIN_PROGRESS', topic.funded)
          : condition('NONE', null),
      text: `I will not ignore the objection. Show verifiable progress and the discussion can move on. ${facts}`,
    };
  }
  return {
    stance: 'SUPPORT',
    condition:
      topic.kind === 'PROJECT' ? condition('MIN_PROGRESS', topic.funded) : condition('NONE', null),
    text: `Your position is noted. ${facts} I support moving forward with owner approval.`,
  };
}

function draft(
  speaker: AgentProfile,
  opponent: AgentProfile,
  topic: Topic,
  block: string,
  prior: readonly DebateMessage[],
): Draft {
  const previous = [...prior].reverse().find((message) => message.speakerAgentId === opponent.agentId);
  if (previous === undefined) return firstDraft(speaker.persona, topic, block);
  // Round 2 may reference the stance, never the raw text (prompt-injection safe).
  return replyDraft(speaker.persona, topic, block, previous.stance);
}

export function runDebate(input: DebateInput): DebateResult {
  const { observation, participants, maxRounds } = validateInput(input);
  const topic = chooseTopic(observation);
  if (topic === null) {
    throw new DebateError('NO_TOPIC', 'no confirmed project or open proposal to debate');
  }

  const messages: DebateMessage[] = [];
  let rejected = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    // Alternate who opens each round.
    const order =
      round % 2 === 0 ? [participants[0], participants[1]] : [participants[1], participants[0]];

    for (const speaker of order) {
      const opponent = speaker.agentId === participants[0].agentId ? participants[1] : participants[0];
      const draftMessage = draft(
        speaker,
        opponent,
        topic,
        observation.sourceBlock,
        messages,
      );

      let verdict: ModerationVerdict;
      try {
        verdict = input.moderate(draftMessage.text);
      } catch {
        return { messages, rejected, stoppedReason: 'MODERATION_UNAVAILABLE' };
      }
      if (verdict === 'UNAVAILABLE') {
        return { messages, rejected, stoppedReason: 'MODERATION_UNAVAILABLE' };
      }
      if (verdict === 'REJECTED') {
        rejected += 1;
        continue;
      }

      const candidate = {
        threadId: input.threadId,
        epochId: observation.epochId,
        speakerAgentId: speaker.agentId,
        targetAgentId: opponent.agentId,
        stance: draftMessage.stance,
        condition: draftMessage.condition,
        text: draftMessage.text,
        groundedInSnapshotBlock: observation.sourceBlock,
        turnIndex: messages.length,
        moderation: 'APPROVED' as const,
        provenance: 'AI_SIMULATED' as const,
      };
      const parsed = debateMessageSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new DebateError('INVALID_MESSAGE', 'generated debate message is invalid');
      }
      messages.push(parsed.data);
    }
  }

  return { messages, rejected, stoppedReason: 'COMPLETED' };
}
