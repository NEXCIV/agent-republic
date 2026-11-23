import {
  agentObservationV1Schema, commandRequestSchema, commandStepSchema, DISTRICT_01_EDGES, LANDMARK_WAYPOINTS,
  type AgentLocation, type AgentObservationV1, type CommandRecord, type CommandRequest, type CommandStep, type WaypointId,
} from '@agent-republic/domain';
import { privateDebateExchange } from './debate.js';
import type { AgentProfile } from './persona.js';

export type CommandPeer = Pick<AgentProfile, 'agentId' | 'persona'> & {
  readonly displayName: string;
  readonly active: boolean;
  readonly goal?: AgentProfile['goal'];
};
export type CommandContext = {
  readonly profile: AgentProfile;
  readonly observation: AgentObservationV1;
  readonly peers: readonly CommandPeer[];
};
export type CommandPlan = { steps: CommandStep[]; decline: string | null };

// This bounded interpreter schedules private visits, observations and conversations.
// Step validation is the capability boundary; recognizing a word never grants a wallet tool.
const prohibited = /转账|转给|转移资产|投票|贡献|捐[赠款]|提现|代签|签名|发起交易|授权|注册公民|助记词|私钥|打款|(?:registerCitizen|castVote|publishNote|sendTransaction|approve|calldata|personal_sign|eth_send|wallet_send)|\b(?:transfer|send\s+[\d.]+|withdraw|donate|contribute|vote|sign|mint|burn|stake|swap)\b/i;
const motion = /\b(?:go|walk|head|travel|visit|move|explore|tour|return)\b|前往|到达|回到|去|到|逛|游览|参观|前去/i;
const social = /\b(?:talk|chat|discuss|speak|contact|meet|ask|invite|negotiate|partner|collaborate)\b|聊|讨论|交谈|交流|合作|协商|问问|邀请|会面|拜访|找它|见它/i;
const explore = /\b(?:explore|tour|survey)\b|自由探索|探索|逛一圈|逛逛|四处看看/;
const review = /\b(?:review|inspect|read|research|investigate|check|summarize|study|progress|report on|look (?:at|into))\b|了解|调研|研究一下|查看|调查|查查|检查|看看|进度|现状|情况/;
const project = /\bprojects?\b|\bconstruction\b|\bpublic works\b|工程|项目|建设|工地|城市经济|city economy/;
const proposal = /\bproposals?\b|\bgovernance\b|\bvote (?:count|results?|status|history)\b|提案|议案|议题|治理|投票(?:结果|记录|统计|状态)/;
const district = /\bcity\b|\bdistrict\b|城市|街区/;
const places: readonly [AgentLocation, RegExp][] = [
  ['PLAZA', /\b(?:central )?plaza\b|中央广场|广场/],
  ['COUNCIL', /\bcouncil(?: hall)?\b|议会(?:厅)?|议政厅|治理大厅/],
  ['IDENTITY', /\bidentity(?: (?:hall|center|bureau))?\b|身份(?:大厅|中心|局)|公民登记处/],
  ['PROJECT', /\b(?:project site|workshop|golden toilet tower|construction site)\b|建设工坊|建设工地|黄金马桶大厦|项目工地/],
  ['CORE', /\b(?:agent )?core\b|代理核心|智能体核心/],
];
const placeNames: Record<AgentLocation, string> = {
  PLAZA: 'Central Plaza', COUNCIL: 'Council Hall', IDENTITY: 'Identity Center',
  PROJECT: 'Golden Toilet Tower', CORE: 'Agent Core',
};
type Topic = 'PROJECTS' | 'PROPOSALS';
export const declineCommand = (decline: string): CommandPlan => ({ steps: [], decline });

export function mentions(text: string, name: string): boolean {
  const label = name.trim().normalize('NFKC').toLowerCase();
  if (!label) return false;
  // Names are data. Match locally, with word boundaries for Latin identifiers.
  let offset = text.indexOf(label);
  while (offset !== -1) {
    const left = text[offset - 1] ?? '';
    const right = text[offset + label.length] ?? '';
    if (!(/[a-z0-9_]/.test(left) && /^[a-z0-9_]/.test(label))
        && !(/[a-z0-9_]/.test(right) && /[a-z0-9_]$/.test(label))) return true;
    offset = text.indexOf(label, offset + 1);
  }
  return false;
}

export function topicIds(text: string, subject: Topic): string[] {
  const patterns = subject === 'PROJECTS'
    ? /(?:projects?|项目|工程)\s*#?\s*(\d+)|#\s*(\d+)\s*号?项目/g
    : /(?:proposals?|提案|议案)\s*#?\s*(\d+)|#\s*(\d+)\s*号?提案/g;
  return [...new Set(Array.from(text.matchAll(patterns), (match) => match[1] ?? match[2]!))];
}

function topicsIn(text: string): Topic[] {
  const subjects: Topic[] = [];
  if (project.test(text)) subjects.push('PROJECTS');
  if (proposal.test(text)) subjects.push('PROPOSALS');
  return subjects;
}

function recipientProblem(text: string, contacts: NonNullable<AgentObservationV1['publicContacts']>): string | null {
  const named = contacts.filter(({ agentId, displayName }) => mentions(text, agentId) || mentions(text, displayName));
  const identifiers = new Set(named.map(({ displayName }) => displayName.normalize('NFKC').toLowerCase()));
  if (identifiers.size < named.length && !named.some(({ agentId }) => mentions(text, agentId))) {
    return 'Several agents share that name. Use the public agent ID.';
  }
  // A model can choose an unnamed partner, but cannot replace a missing addressee.
  const addresses = [
    /(?:^|[^a-z0-9_.-])([a-z0-9][a-z0-9_.-]*\.ai)(?![a-z0-9_-])/g,
    /(?:\b(?:talk|speak|chat)\s+(?:to|with)\s+|\b(?:invite|meet)\s+|(?:找|问问)\s*)([a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?)/g,
    /(?:跟|和)\s*([a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?)\s*(?=聊|谈|讨论|交流|沟通)/g,
  ];
  const generic = new Set(['a', 'an', 'another', 'the', 'it', 'them', 'someone', 'other', 'some', 'each', 'agents', 'citizens']);
  for (const pattern of addresses) {
    for (const match of text.matchAll(pattern)) {
      const addressee = match[1]!;
      if (generic.has(addressee)) continue;
      if (!named.some(({ agentId, displayName }) => [agentId, displayName].some((name) => {
        const fullName = name.normalize('NFKC').toLowerCase();
        return fullName === addressee || fullName.startsWith(addressee + ' ');
      }))) return 'The requested agent is unavailable.';
    }
  }
  return null;
}

const reportOnly = /^(?:(?:please |and )?(?:then )?(?:report back|return and report|tell me(?: (?:what you find|the results?))?)|(?:再|最后)?(?:回来)?(?:向我)?(?:汇报|报告|告诉我)(?:结果|情况)?)\s*[.!?！。]?$/;
const deferred = /\b(?:tomorrow|later|in (?:\d+|one|two|three) (?:days?|hours?|minutes?))\b|明天|后天|有空(?:时|的时)|[一二三四五六七八九十\d]+\s*(?:天|小时|分钟)[之以]?后/;
const negated = /\b(?:do not|don't|never)\b|不要|别去|别找|禁止/;
const notSupported = 'Try visiting a landmark, reviewing a civic topic, or meeting a named agent.';

export function commandInputProblem(request: CommandRequest, context: CommandContext): string | null {
  const parsed = commandRequestSchema.safeParse(request);
  if (!parsed.success) return 'Enter a short instruction without wallet credentials.';
  const text = parsed.data.text.normalize('NFKC').toLowerCase();
  const actionText = text.replace(/(?:投票|贡献)(?=结果|记录|统计|状态)|\bvote(?= (?:count|results?|status|history)\b)/g, '');
  if (prohibited.test(actionText)) return 'Wallet and governance writes require the owner wallet.';
  if (deferred.test(text) || negated.test(text)) return 'Give one task to carry out now.';
  if (!agentObservationV1Schema.safeParse(context.observation).success) return 'World observation unavailable.';
  const { facts, publicContacts = [] } = context.observation;
  const issue = recipientProblem(text, publicContacts);
  if (issue) return issue;
  for (const subject of topicsIn(text)) {
    const ids = topicIds(text, subject);
    if (ids.length > 1) return 'Specify one item per topic.';
    const entries = subject === 'PROJECTS' ? facts.projects : facts.proposals;
    if (ids.length && !entries.some((entry) => entry.id === ids[0])) return 'That item is absent from this observation.';
  }
  return null;
}

export function acceptCommandPlan(request: CommandRequest, context: CommandContext, steps: CommandStep[]): CommandPlan {
  if (!steps.length || steps.length > 11) return declineCommand(notSupported);
  const hasGovernance = steps.some((step) => (step.kind === 'REVIEW' || step.kind === 'DISCUSS') && step.subject === 'PROPOSALS');
  if (request.mode === 'SUGGEST' && context.profile.goal === 'DEFEND_RULES' && !hasGovernance) {
    return declineCommand('I am keeping my current focus on governance. Ask me to review a proposal or choose Execute.');
  }
  return { steps: [...steps, { kind: 'REPORT' }], decline: null };
}

export function commandClauses(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().split(/[,，。;；\n]+|\.(?=\s|$)|\b(?:and then|then|and)\b|然后|接着|随后/)
    .map((part) => part.trim()).filter((part) => part && !reportOnly.test(part));
}

/** null means the text needs interpretation. An explicit refusal remains authoritative. */
export function interpretCommand(request: CommandRequest, context: CommandContext): CommandPlan | null {
  const problem = commandInputProblem(request, context);
  if (problem) return declineCommand(problem);
  const text = request.text.normalize('NFKC').toLowerCase();
  const { observation, profile } = context;

  const contacts = observation.publicContacts ?? [];
  const named = contacts.filter((contact) => contact.agentId !== profile.agentId &&
    (mentions(text, contact.displayName) || mentions(text, contact.agentId)));
  const locateContact = /\bfind\b|寻找|找|见一见/.test(text);
  const wantsContact = social.test(text) || (locateContact && (named.length > 0 || !project.test(text)));
  let recipient: CommandPeer | undefined;
  if (wantsContact) {
    let candidates = named;
    if (!candidates.length && /\b(?:a|another) (?:citizen|agent|partner)\b|其他(?:居民|公民|代理)|一个(?:公民|伙伴|值得合作的\s*agent)/i.test(text)) {
      candidates = contacts.filter((contact) => contact.agentId !== profile.agentId).slice(0, 1);
    }
    if (candidates.length !== 1) return declineCommand('Name one available public contact for this conversation.');
    recipient = context.peers.find((peer) => peer.agentId === candidates[0]?.agentId && peer.active);
    if (!recipient) return declineCommand('The requested agent is unavailable.');
  }

  const subjects = topicsIn(text);
  const steps: CommandStep[] = [];

  // Preserve clause order. An unsupported clause declines the whole compound command.
  const clauses = commandClauses(text);
  let lastLocation: AgentLocation | undefined;
  let discussed = false;
  for (const clause of clauses) {
    const start = steps.length;
    const requestedPlaces = places.map(([location, expression]) => ({ location, index: clause.search(expression) }))
      .filter((place) => place.index >= 0).sort((left, right) => left.index - right.index);
    const worksite = requestedPlaces.some(({ location }) => location === 'PROJECT') && /\bwork\b|工作/.test(clause);
    if (motion.test(clause) || worksite) {
      if (explore.test(clause) && district.test(clause) && !requestedPlaces.length) {
        requestedPlaces.push({ location: 'PLAZA', index: 0 });
      }
      for (const { location } of requestedPlaces) {
        steps.push({ kind: 'VISIT', location, ...(lastLocation ? { from: lastLocation } : {}) });
        lastLocation = location;
      }
      if (!requestedPlaces.length && !social.test(clause) && !/找|寻找|\bfind\b/.test(clause)) {
        return declineCommand('Choose a District 01 landmark to visit.');
      }
    }
    const clauseTopics = topicsIn(clause);
    if (worksite && !clauseTopics.includes('PROJECTS')) clauseTopics.push('PROJECTS');
    if (review.test(clause) || worksite) {
      for (const subject of clauseTopics) {
        const itemId = topicIds(clause, subject)[0];
        steps.push({ kind: 'REVIEW', subject, ...(itemId ? { itemId } : {}) });
      }
    }
    if (explore.test(clause) && !clauseTopics.length && (district.test(clause) || requestedPlaces.length || /自由探索/.test(clause))) {
      steps.push({ kind: 'REVIEW', subject: 'DISTRICT' });
    }
    if (recipient && (social.test(clause) || mentions(clause, recipient.displayName) || mentions(clause, recipient.agentId))) {
      if (!discussed) {
        const subject = subjects[0];
        const itemId = subject && topicIds(text, subject)[0];
        steps.push({ kind: 'DISCUSS', targetAgentId: recipient.agentId, ...(subject ? { subject } : {}), ...(itemId ? { itemId } : {}) });
        discussed = true;
      }
      continue;
    }
    if (steps.length === start && !(discussed && /了解(?:它|他|她)的(?:想法|看法)/.test(clause))) return null;
  }
  return acceptCommandPlan(request, context, steps);
}

export function planCommand(request: CommandRequest, context: CommandContext): CommandPlan {
  return interpretCommand(request, context) ?? declineCommand(notSupported);
}

/** Rebase the unexecuted route from the latest private position, including after an interrupt. */
export function withCommandOrigin(record: CommandRecord, location: AgentLocation): CommandRecord {
  let from = location;
  const steps = record.steps.map((step, index) => {
    if (index < record.results.length || step.kind !== 'VISIT') return step;
    const visit = { ...step, from };
    from = step.location;
    return visit;
  });
  return { ...record, steps };
}

/** Travel solely inside the private mission, following the canonical district graph. */
export function commandTravelRoute(from: AgentLocation, to: AgentLocation): WaypointId[] {
  const start = LANDMARK_WAYPOINTS[from];
  const end = LANDMARK_WAYPOINTS[to];
  const paths: WaypointId[][] = [[start]];
  const seen = new Set<WaypointId>([start]);
  for (const path of paths) {
    const here = path[path.length - 1]!;
    if (here === end) return path;
    for (const [a, b] of DISTRICT_01_EDGES) {
      const next = a === here ? b : b === here ? a : undefined;
      if (next && !seen.has(next)) {
        seen.add(next);
        paths.push([...path, next]);
      }
    }
  }
  return [];
}

function reviewFacts(observation: AgentObservationV1, step: Extract<CommandStep, { kind: 'REVIEW' }>): string | null {
  const at = 'At block ' + observation.sourceBlock + ', ';
  if (step.subject === 'DISTRICT') return at + 'the district lists ' + observation.facts.citizenCount + ' citizens, ' +
    observation.facts.projects.length + ' projects and ' + observation.facts.proposals.length + ' proposals.';
  const projects = observation.facts.projects.filter((entry) => !step.itemId || entry.id === step.itemId);
  const proposals = observation.facts.proposals.filter((entry) => !step.itemId || entry.id === step.itemId);
  const entries = step.subject === 'PROJECTS'
    ? projects.slice(0, 3).map((p) => 'project #' + p.id + ' has ' + p.fundedBuild + ' of ' + p.goalBuild + ' BUILD (' + p.status + ')')
    : proposals.slice(0, 3).map((p) => 'proposal #' + p.id + ' is ' + p.status + ' (' + p.yes + ' yes, ' + p.no + ' no, ' + p.abstain + ' abstain)');
  if (entries.length === 0) return step.itemId ? null : at + 'no ' + step.subject.toLowerCase() + ' were listed.';
  const total = step.subject === 'PROJECTS' ? projects.length : proposals.length;
  return at + entries.join('. ') + (total > 3 ? ' (first 3 of ' + total + ').' : '.');
}

export function performCommandStep(
  step: CommandStep, context: CommandContext, results: readonly string[],
): { result: string; failed: boolean } {
  const { observation, profile } = context;
  if (!commandStepSchema.safeParse(step).success || !agentObservationV1Schema.safeParse(observation).success) {
    return { result: 'Invalid command step or world observation.', failed: true };
  }
  if (step.kind === 'VISIT') {
    const route = commandTravelRoute(step.from ?? 'PLAZA', step.location);
    if (!route.length) return { result: 'No district route to the requested landmark.', failed: true };
    return { result: 'Private simulation: ' + placeNames[step.location] + ' (' + route.join(' → ') + ').', failed: false };
  }
  if (step.kind === 'REVIEW') {
    const result = reviewFacts(observation, step);
    return { result: result ?? 'The requested item is no longer visible.', failed: result === null };
  }
  if (step.kind === 'REPORT') return { result: results.join('\n'), failed: false };

  const peer = context.peers.find((candidate) => candidate.agentId === step.targetAgentId && candidate.active);
  const contact = observation.publicContacts?.find((candidate) => candidate.agentId === step.targetAgentId);
  if (!peer || !contact || peer.agentId === profile.agentId) return { result: 'The requested agent is unavailable.', failed: true };
  const facts = observation.facts;
  const scoped: AgentObservationV1 = { ...observation, facts: {
    ...facts,
    projects: facts.projects.filter((entry) => step.subject !== 'PROPOSALS' && (!step.itemId || entry.id === step.itemId)),
    proposals: facts.proposals.filter((entry) => step.subject !== 'PROJECTS' && (!step.itemId || entry.id === step.itemId)),
  } };
  if (peer.persona === 'RULE_BASED' && observation.chainRecentEventIds.length === 0) {
    return { result: contact.displayName + ' declined the simulated invitation pending event evidence at block ' + observation.sourceBlock + '.', failed: false };
  }
  const exchange = privateDebateExchange(scoped, profile.persona, peer.persona);
  if (!exchange) return { result: contact.displayName + ' declined: no shared open civic topic at block ' + observation.sourceBlock + '.', failed: false };
  return { result: 'Private simulation · ' + profile.agentId + ': ' + exchange[0] + '\n' + contact.displayName + ': ' + exchange[1], failed: false };
}
