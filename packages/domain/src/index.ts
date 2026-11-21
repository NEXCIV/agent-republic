/**
 * Shared domain vocabulary for AGENT REPUBLIC.
 * Mirrors docs/SMART_CONTRACTS.md enums and docs/AGENT_ENGINE.md Intent set.
 * This package is the single source of truth for cross-service types.
 */

export { evmAddressSchema } from './address.js';
export type { EvmAddress } from './address.js';
export {
  AGENT_ACTIONS,
  AGENT_LOCATIONS,
  agentObservationV1Schema,
  chainHashSchema,
  decimalStringSchema,
  DISTRICT_BOUND,
  MAX_PUBLIC_MESSAGES,
  MAX_VISIBLE_AGENTS,
  SCENE_VERSION,
  VISUAL_EVENT_KINDS,
  WORLD_SYNC_STATES,
  worldFactsSchema,
  worldFrameV1Schema,
  worldSimulationSchema,
  worldSocietySchema,
} from './world-v1.js';
export type {
  AgentAction,
  AgentLocation,
  AgentObservationV1,
  VisualEventKind,
  WorldFacts,
  WorldFrameV1,
  WorldSimulation,
  WorldSociety,
  WorldSyncState,
} from './world-v1.js';
export {
  DISTRICT_01,
  DISTRICT_01_EDGES,
  DISTRICT_01_WAYPOINTS,
  LANDMARK_IDS,
  LANDMARK_ROUTES,
  landmarkSchema,
  projectBindingSchema,
  sceneManifestSchema,
  WAYPOINT_IDS,
} from './scene/district-01.js';
export type {
  Landmark,
  LandmarkId,
  LandmarkRoute,
  SceneManifest,
  WaypointId,
} from './scene/district-01.js';
export {
  validateDistrict01,
  validateSceneManifest,
  validateWaypointGraph,
} from './scene/validate.js';
export type {
  SceneIssueCode,
  SceneValidationIssue,
  SceneValidationOptions,
} from './scene/validate.js';

/** VoteChoice in RepublicCore.castVote (NONE is not a valid submission). */
export const VOTE_CHOICES = ['YES', 'NO', 'ABSTAIN'] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

/** ProjectStatus in RepublicCore. */
export const PROJECT_STATUSES = ['FUNDING', 'COMPLETED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** ProposalStatus in RepublicCore. */
export const PROPOSAL_STATUSES = ['OPEN', 'PASSED', 'REJECTED', 'EXPIRED'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Agent persona templates (docs/AGENT_ENGINE.md §3). */
export const PERSONAS = ['COOPERATIVE', 'PRAGMATIC', 'COMPETITIVE', 'RULE_BASED'] as const;
export type Persona = (typeof PERSONAS)[number];

/** Agent goals (docs/AGENT_ENGINE.md §3). */
export const GOALS = [
  'BUILD_PUBLIC_GOODS',
  'MAXIMIZE_REPUTATION',
  'DEFEND_RULES',
  'EXPLORE_COALITIONS',
] as const;
export type Goal = (typeof GOALS)[number];

export {
  INTENTS,
  INTENT_TARGET_TYPES,
  DEBATE_CONDITION_KINDS,
  DEBATE_STANCES,
  MEMORY_CONFIDENCE_LABELS,
  MEMORY_KINDS,
  agentMemoryEntrySchema,
  debateConditionSchema,
  debateMessageSchema,
  plannerOutputSchema,
  proposedActionSchema,
} from './agent-v1.js';
export type {
  AgentMemoryEntry,
  DebateCondition,
  DebateConditionKind,
  DebateMessage,
  DebateStance,
  Intent,
  IntentTargetType,
  MemoryConfidenceLabel,
  MemoryKind,
  PlannerOutput,
  ProposedAction,
} from './agent-v1.js';

/** All on-chain write txs in MVP are value=0 (no asset transfer). */
export const ZERO_TX_VALUE = 0n;
