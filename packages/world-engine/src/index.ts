/**
 * World engine placeholder — implementation lands in Epic E5
 * (docs/WORLD_ENGINE.md, docs/IMPLEMENTATION_PLAN.md E5-01..E5-08).
 *
 * Core invariants to preserve when implementing:
 * - WorldReducer is a pure function: next = reduceWorld(previous, verifiedEvent,
 *   deterministicContext). No network, clock, LLM or DOM access.
 * - Same events + seed + tick => byte-identical frameId (W-01).
 * - Chain facts only from CONFIRMED events; SUBMITTED/INCLUDED must not
 *   advance fundedBuild or building stages (W-02).
 * - 60s sim tick never calls LLM and never writes chain/economic state.
 */

export const WORLD_ENGINE_VERSION = '0.0.1';

export {
  canonicalize,
  computeFrameId,
  FrameCanonicalizationError,
  withFrameId,
} from './frame-id.js';
export {
  GENESIS_TITLE_KEY,
  reduceChainEvents,
  reduceFacts,
} from './reducer.js';
export type {
  ReduceFactsResult,
  VerifiedChainEvent,
  WorldFactsContext,
} from './reducer.js';
export {
  deriveProjectProgressBasisPoints,
  deriveProjectStage,
  PROJECT_STAGES,
  ProjectStageError,
  stageRank,
  toChainVisualEvent,
} from './stages.js';
export type { ChainVisualEvent, ProjectAmounts, ProjectStage } from './stages.js';
export {
  initialAgentStates,
  MAX_AGENTS_PER_STEP,
  positionOf,
  SimulationError,
  stepSimulation,
  toSimAgentStates,
} from './simulation.js';
export type {
  SimAgentState,
  SimStepInput,
  SimStepResult,
  SimulatedAgentPosition,
  SimVisualEventDraft,
} from './simulation.js';
export {
  buildWorldFrame,
  epochIdFromTimestamp,
  WorldFrameBuildError,
} from './frame.js';
export type { BuildWorldFrameInput, WorldFrameSourceInput } from './frame.js';
export {
  getSceneManifest,
  sceneManifestHash,
  SceneManifestError,
} from './scene-manifest.js';
export type { SceneManifestPayload } from './scene-manifest.js';
