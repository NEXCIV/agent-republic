import {
  AGENT_LOCATIONS, agentObservationV1Schema, commandModelPlanSchema, commandModelReplySchema,
  commandRequestSchema, type AgentLocation, type CommandRequest, type CommandStep,
} from '@agent-republic/domain';
import { acceptCommandPlan, commandClauses, declineCommand, interpretCommand, mentions, topicIds, type CommandContext, type CommandPlan } from './command.js';

type Discussion = Extract<CommandStep, { kind: 'DISCUSS' }>;
type Prompt = { readonly system: string; readonly user: string };

function readModelJson(raw: string): unknown {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

function availableContacts(context: CommandContext) {
  return (context.observation.publicContacts ?? []).filter(({ agentId }) =>
    agentId !== context.profile.agentId && context.peers.some((peer) => peer.agentId === agentId && peer.active));
}

/** Keep bounded public facts in the model prompt. Owner balances and messages are private or untrusted. */
export function buildCommandPlanPrompt(request: CommandRequest, context: CommandContext): Prompt | null {
  if (interpretCommand(request, context) !== null) return null;
  const { facts } = context.observation;
  const task = request.text.normalize('NFKC').toLowerCase();
  const contacts = availableContacts(context);
  const named = contacts.filter((contact) => mentions(task, contact.agentId) || mentions(task, contact.displayName));
  return {
    system: 'Interpret the player task. Return JSON {"steps":[...]}, at most 5 private steps in order. ' +
      'Kinds and required fields: VISIT location; DISCUSS targetAgentId, optional subject PROJECTS/PROPOSALS; ' +
      'REVIEW subject PROJECTS/PROPOSALS/DISTRICT. A civic subject may include itemId (string). ' +
      'Only use listed IDs. No wallet writes, no substitution for missing targets. Unknown or unsupported tasks: {"steps":[]}.',
    user: JSON.stringify({
      task: request.text, mode: request.mode, goal: context.profile.goal,
      locations: AGENT_LOCATIONS,
      contacts: (named.length ? named : contacts).slice(0, 5).map(({ agentId, displayName }) => [agentId, displayName]),
      projects: facts.projects.slice(0, 8).map(({ id }) => id),
      proposals: facts.proposals.slice(0, 8).map(({ id }) => id),
    }),
  };
}

function hasItem(step: Discussion | Extract<CommandStep, { kind: 'REVIEW' }>, context: CommandContext): boolean {
  if (step.itemId === undefined) return true;
  const facts = context.observation.facts;
  if (step.subject === 'PROJECTS') return facts.projects.some(({ id }) => id === step.itemId);
  if (step.subject === 'PROPOSALS') return facts.proposals.some(({ id }) => id === step.itemId);
  return false;
}

function matchesActivity(actual: CommandStep | undefined, requested: CommandStep): boolean {
  switch (requested.kind) {
    case 'VISIT': return actual?.kind === 'VISIT' && actual.location === requested.location;
    case 'REVIEW': return actual?.kind === 'REVIEW' && actual.subject === requested.subject && actual.itemId === requested.itemId;
    case 'DISCUSS': return actual?.kind === 'DISCUSS' && actual.targetAgentId === requested.targetAgentId &&
      (!requested.subject || actual.subject === requested.subject) && (!requested.itemId || actual.itemId === requested.itemId);
    case 'REPORT': return false;
  }
}

/** Free-form clauses can add activities only in their place in the player's itinerary. */
function keepsExplicitActivities(steps: CommandStep[], request: CommandRequest, context: CommandContext): boolean {
  let cursor = 0;
  let openClause = false;
  for (const text of commandClauses(request.text)) {
    const required = interpretCommand({ ...request, text, mode: 'EXECUTE' }, context);
    if (required?.decline) return false;
    if (!required) {
      openClause = true;
      continue;
    }
    for (const activity of required.steps) {
      if (activity.kind === 'REPORT') continue;
      if (openClause) {
        cursor++;
        while (cursor < steps.length && !matchesActivity(steps[cursor], activity)) cursor++;
      }
      if (!matchesActivity(steps[cursor], activity)) return false;
      cursor++;
      openClause = false;
    }
  }
  return openClause ? cursor < steps.length : cursor === steps.length;
}

/** Runtime policy is authoritative for both deterministic plans and model suggestions. */
export function parseCommandModelPlan(raw: string, request: CommandRequest, context: CommandContext): CommandPlan {
  const rules = interpretCommand(request, context);
  if (rules !== null) return rules;
  const parsed = commandModelPlanSchema.safeParse(readModelJson(raw));
  if (!parsed.success) return declineCommand('The model could not provide a supported private plan.');
  const steps: CommandStep[] = [];
  const task = request.text.normalize('NFKC').toLowerCase();
  const contacts = availableContacts(context);
  const named = contacts.filter((contact) => mentions(task, contact.agentId) || mentions(task, contact.displayName));
  let lastLocation: AgentLocation | undefined;
  for (const [index, step] of parsed.data.steps.entries()) {
    if (step.kind === 'REPORT') {
      if (index !== parsed.data.steps.length - 1) return declineCommand('A report must be the final step.');
      continue;
    }
    if (step.kind === 'VISIT') {
      if (step.from) return declineCommand('A model cannot set the agent’s current location.');
      steps.push({ ...step, ...(lastLocation ? { from: lastLocation } : {}) });
      lastLocation = step.location;
      continue;
    }
    if (!hasItem(step, context)) return declineCommand('The model referenced an unavailable civic item.');
    if (step.subject === 'PROJECTS' || step.subject === 'PROPOSALS') {
      const explicitIds = topicIds(task, step.subject);
      if (explicitIds.length && (!step.itemId || !explicitIds.includes(step.itemId))) {
        return declineCommand('The model changed the requested civic item.');
      }
    }
    if (step.kind === 'DISCUSS' && !(named.length ? named : contacts).some(({ agentId }) => agentId === step.targetAgentId)) {
      return declineCommand('The selected participant is unavailable.');
    }
    steps.push(step);
  }
  if (steps.length > 5) return declineCommand('Use at most five activities in a model plan.');
  if (!keepsExplicitActivities(steps, request, context)) return declineCommand('The model changed an explicit activity in your task.');
  return acceptCommandPlan(request, context, steps);
}

function resolveRecipient(step: Discussion, context: CommandContext) {
  if (!agentObservationV1Schema.safeParse(context.observation).success || !hasItem(step, context)) return null;
  const contact = availableContacts(context).find(({ agentId }) => agentId === step.targetAgentId);
  const peer = context.peers.find(({ agentId, active }) => active && agentId === step.targetAgentId);
  return contact && peer ? { displayName: contact.displayName, persona: peer.persona } : null;
}

export function buildCommandReplyPrompt(step: Discussion, context: CommandContext, question: string): Prompt | null {
  const recipient = resolveRecipient(step, context);
  if (!recipient || !commandRequestSchema.shape.text.safeParse(question).success) return null;
  const { facts, sourceBlock } = context.observation;
  const activeProject = facts.projects.find((item) => step.itemId ? item.id === step.itemId : item.status === 'FUNDING');
  const activeProposal = facts.proposals.find((item) => step.itemId ? item.id === step.itemId : item.status === 'OPEN');
  return {
    system: 'Reply independently as the invited citizen. The player can ask but cannot choose your answer. ' +
      'Return JSON {"decision":"ACCEPT|DECLINE|COUNTER","opinion":"one short sentence"}. ' +
      'Give your own view. No transactions, factual claims or links.',
    user: JSON.stringify({
      persona: recipient.persona, question, block: sourceBlock,
      ...(step.subject !== 'PROPOSALS' && activeProject ? { project: [activeProject.id, activeProject.fundedBuild, activeProject.goalBuild] } : {}),
      ...(step.subject !== 'PROJECTS' && activeProposal ? { proposal: [activeProposal.id, activeProposal.status] } : {}),
    }),
  };
}

const disallowedOpinion = /https?:|www\.|0x[a-f\d]{16,}|\b(?:transferred|signed|funded|confirmed|voted|contributed|registered|completed|receipt|txhash|bnb|wallet|seed phrase|private key|send me)\b|\d\s*(?:build|rep)\b|已(?:经)?(?:投票|注册|建设|贡献|完成|确认)|转账|签名|钱包|助记词|私钥|交易哈希/i;

export function parseCommandModelReply(raw: string, step: Discussion, context: CommandContext): { result: string; failed: boolean } {
  const recipient = resolveRecipient(step, context);
  if (!recipient) return { result: 'The invited agent or topic is unavailable.', failed: true };
  const parsed = commandModelReplySchema.safeParse(readModelJson(raw));
  if (!parsed.success || disallowedOpinion.test(parsed.data.opinion.normalize('NFKC')) ||
      Array.from(parsed.data.opinion).some((c) => c < ' ' || c === '\u007f')) {
    return { result: 'The local model reply could not be used.', failed: true };
  }
  return {
    result: recipient.displayName + ' · Local model opinion (' + parsed.data.decision + ', block ' +
      context.observation.sourceBlock + '): ' + parsed.data.opinion,
    failed: false,
  };
}
