/**
 * Agent runtime — E3-01 planner output validation.
 * The engine MUST keep LLM output out of any authorization path.
 */

export const AGENT_ENGINE_VERSION = '0.0.1';
export { makeCommandRecord, advanceCommandRecord } from './command-journal.js';
export { commandTravelRoute, planCommand, performCommandStep, withCommandOrigin } from './command.js';
export type { CommandContext, CommandPeer, CommandPlan } from './command.js';
export { buildCommandPlanPrompt, buildCommandReplyPrompt, parseCommandModelPlan, parseCommandModelReply } from './command-model.js';

export {
  AgentOutputError,
  parsePlannerJson,
  parsePlannerOutput,
} from './action.js';
export type {
  AgentActionContext,
  AgentOutputErrorCode,
} from './action.js';
export {
  AgentObservationError,
  buildAgentObservation,
} from './observation.js';
export type {
  AgentObservationErrorCode,
  ObservationOptions,
  OwnerChainState,
} from './observation.js';
export {
  GOAL_GUIDANCE,
  PERSONA_GUIDANCE,
  PLANNER_PROMPT_VERSION,
  buildPlannerPrompts,
} from './persona.js';
export type { AgentProfile } from './persona.js';
export {
  PlannerError,
  planRuleBased,
  planWithProvider,
} from './planner.js';
export type {
  PlannerErrorCode,
  PlannerModelProvider,
  PlannerModelRequest,
  PlannerPlanInput,
  PlannerResult,
  PlannerSource,
} from './planner.js';
export {
  POLICY_VERSION,
  validateAction,
} from './policy.js';
export type {
  ModerationVerdict,
  PolicyAgent,
  PolicyAgentStatus,
  PolicyContext,
  PolicyDecision,
  PolicyMode,
  PolicyRejectionCode,
  PolicySnapshot,
} from './policy.js';
export {
  DebateError,
  runDebate,
} from './debate.js';
export type {
  DebateErrorCode,
  DebateInput,
  DebateResult,
  DebateStopReason,
} from './debate.js';
export {
  MEMORY_INTENT_STATUSES,
  MEMORY_RETRIEVAL_LIMITS,
  MemoryError,
  buildEpochReflection,
  retrieveMemories,
} from './memory.js';
export type {
  MemoryErrorCode,
  MemoryIntentOutcome,
  MemoryIntentStatus,
  MemoryRetrievalOptions,
  ReflectionInput,
  ReflectionResult,
} from './memory.js';
export {
  AGENT_DAILY_LIMITS,
  LlmBudgetError,
  LlmBudgetGuard,
  estimateTokens,
  spendBudget,
  withLlmBudget,
} from './budget.js';
export type {
  BudgetedPlannerOptions,
  LlmBudgetConfig,
  LlmBudgetContext,
  LlmBudgetDenialCode,
  LlmBudgetReservation,
  LlmBudgetSnapshot,
  LlmCallKind,
  LlmModelPrice,
  LlmUsageRecord,
} from './budget.js';
