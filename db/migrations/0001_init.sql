-- AGENT REPUBLIC — initial schema (task E2-01)
-- Source of truth: docs/ARCHITECTURE.md §6, docs/WORLD_ENGINE.md §7.
--
-- Requirements:
--   * PostgreSQL 13+ (built-in gen_random_uuid()).
--   * Applying every file in db/migrations/ in filename order to an EMPTY
--     database must reconstruct the full schema (clean-DB rebuild DoD).
--   * On-chain facts (BUILD/REP/citizen state) live in the contracts; the
--     tables below are a rebuildable projection, never a second ledger.
--
-- Conventions:
--   * addresses: lowercase 42-char hex, enforced by the evm_address domain.
--   * hashes (tx/block/commitment/content): lowercase 66-char hex.
--   * on-chain amounts: NUMERIC(78,0) — full uint256 range, no float math.

BEGIN;

-- Migration bookkeeping, maintained by the migration runner (E2-02).
CREATE TABLE schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Shared domains
-- ---------------------------------------------------------------------------

CREATE DOMAIN evm_address AS TEXT
  CHECK (VALUE ~ '^0x[0-9a-f]{40}$');

CREATE DOMAIN hex_hash66 AS TEXT
  CHECK (VALUE ~ '^0x[0-9a-f]{64}$');

CREATE DOMAIN build_amount AS NUMERIC(78, 0)
  CHECK (VALUE >= 0);

-- ---------------------------------------------------------------------------
-- Identity & accounts (docs/ARCHITECTURE.md §5, §6)
-- ---------------------------------------------------------------------------

-- Web2 accounts manage preferences only; they are NOT citizenship.
CREATE TABLE app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider TEXT NOT NULL CHECK (auth_provider IN ('PASSKEY', 'EMAIL_MAGIC_LINK')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- One challenge = one nonce = one on-chain registration commitment.
CREATE TABLE auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id UUID NOT NULL REFERENCES app_users (id),
  owner evm_address NOT NULL,
  -- personaConfigHash component of the commitment (ARCHITECTURE §5.1).
  agent_config_hash hex_hash66 NOT NULL,
  nonce_hash hex_hash66 NOT NULL,
  commitment hex_hash66 NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_challenges_app_user_idx ON auth_challenges (app_user_id);

-- owner <-> app_user binding is proven only by a confirmed registry event.
CREATE TABLE identity_bindings (
  owner evm_address PRIMARY KEY,
  app_user_id UUID NOT NULL UNIQUE REFERENCES app_users (id),
  registry_tx_hash hex_hash66 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active AI agent per owner; replaceable, never a rights subject.
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner evm_address NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  persona TEXT NOT NULL CHECK (persona IN ('COOPERATIVE', 'PRAGMATIC', 'COMPETITIVE', 'RULE_BASED')),
  goal TEXT NOT NULL CHECK (goal IN ('BUILD_PUBLIC_GOODS', 'MAXIMIZE_REPUTATION', 'DEFEND_RULES', 'EXPLORE_COALITIONS')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  config_version INT NOT NULL DEFAULT 1 CHECK (config_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable versioned configs; published versions are never rewritten.
CREATE TABLE agent_configs (
  agent_id UUID NOT NULL REFERENCES agents (id),
  version INT NOT NULL CHECK (version > 0),
  config_json_encrypted BYTEA NOT NULL,
  config_hash hex_hash66 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, version)
);

-- ---------------------------------------------------------------------------
-- Chain projections (docs/SMART_CONTRACTS.md, ARCHITECTURE §6)
-- ---------------------------------------------------------------------------

-- Epoch = contract-defined UTC decision day.
CREATE TABLE epochs (
  id BIGINT PRIMARY KEY,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'FINALIZED')),
  finalized_at TIMESTAMPTZ,
  CHECK (end_at > start_at)
);

CREATE TABLE proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_proposal_id BIGINT NOT NULL UNIQUE,
  owner evm_address NOT NULL,
  content_hash hex_hash66 NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PASSED', 'REJECTED', 'EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX proposals_status_idx ON proposals (status);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_project_id BIGINT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  goal_build build_amount NOT NULL,
  funded_build build_amount NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'FUNDING' CHECK (state IN ('FUNDING', 'COMPLETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (funded_build <= goal_build)
);

-- Moderated offchain agent speech; never an on-chain fact.
CREATE TABLE agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epoch_id BIGINT NOT NULL REFERENCES epochs (id),
  agent_id UUID NOT NULL REFERENCES agents (id),
  target_agent_id UUID REFERENCES agents (id),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  moderation_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (moderation_state IN ('PENDING', 'APPROVED', 'REJECTED')),
  visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agent_messages_epoch_agent_idx ON agent_messages (epoch_id, agent_id);

-- ---------------------------------------------------------------------------
-- Action intents (API never signs user transactions, ARCHITECTURE §4, §7)
-- ---------------------------------------------------------------------------

CREATE TABLE action_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner evm_address NOT NULL,
  agent_id UUID REFERENCES agents (id),
  action_type TEXT NOT NULL CHECK (action_type IN ('OBSERVE', 'DISCUSS', 'SUGGEST_VOTE', 'SUGGEST_CONTRIBUTION', 'PUBLISH_NOTE_REQUEST', 'ABSTAIN')),
  target_id TEXT,
  json_payload JSONB NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'EXPIRED', 'REJECTED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  tx_hash hex_hash66,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX action_intents_owner_idx ON action_intents (owner, created_at DESC);

-- User confirmation in the Web2 app; NOT on-chain authorization.
CREATE TABLE action_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES action_intents (id),
  app_user_id UUID NOT NULL REFERENCES app_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (intent_id, app_user_id)
);

-- ---------------------------------------------------------------------------
-- Chain event mirror & sync (ARCHITECTURE §6.1, WORLD_ENGINE §6)
-- ---------------------------------------------------------------------------

-- Rebuildable mirror of contract logs; never an authorization source.
-- Reorg handling: a superseded event is flagged ORPHANED and the projection
-- is recomputed by replaying surviving events.
CREATE TABLE chain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INT NOT NULL CHECK (chain_id IN (56, 97)),
  tx_hash hex_hash66 NOT NULL,
  log_index INT NOT NULL CHECK (log_index >= 0),
  block_number BIGINT NOT NULL CHECK (block_number >= 0),
  block_hash hex_hash66 NOT NULL,
  event_name TEXT NOT NULL,
  owner evm_address,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'INCLUDED' CHECK (status IN ('INCLUDED', 'ORPHANED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index)
);

CREATE INDEX chain_events_block_idx ON chain_events (chain_id, block_number);
CREATE INDEX chain_events_event_idx ON chain_events (chain_id, event_name);
CREATE INDEX chain_events_owner_idx ON chain_events (owner) WHERE owner IS NOT NULL;

CREATE TABLE chain_sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INT NOT NULL CHECK (chain_id IN (56, 97)),
  contract evm_address NOT NULL,
  next_block BIGINT NOT NULL CHECK (next_block >= 0),
  finalized_block BIGINT NOT NULL CHECK (finalized_block >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, contract)
);

-- ---------------------------------------------------------------------------
-- Agent memory, LLM accounting, audit
-- ---------------------------------------------------------------------------

CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents (id),
  kind TEXT NOT NULL,
  -- Chain event / message ids this memory derives from (traceable sources).
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agent_memories_agent_idx ON agent_memories (agent_id, created_at DESC);

CREATE TABLE llm_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL UNIQUE,
  agent_id UUID REFERENCES agents (id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INT NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out INT NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_estimate NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (cost_estimate >= 0),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX llm_usage_agent_idx ON llm_usage (agent_id, created_at DESC);

-- Append-only: the application never issues UPDATE/DELETE here.
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_request_idx ON audit_logs (request_id);

-- ---------------------------------------------------------------------------
-- World engine tables (docs/WORLD_ENGINE.md §7)
-- ---------------------------------------------------------------------------

-- Published scene versions are immutable; changes require a new version.
CREATE TABLE world_scene_versions (
  scene_version INT PRIMARY KEY,
  manifest_hash TEXT NOT NULL,
  active_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Monotonic marker for approved offchain social content changes.
CREATE TABLE social_revisions (
  revision BIGINT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One deterministic world tick per (scene_version, tick); replayable.
CREATE TABLE world_ticks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_version INT NOT NULL REFERENCES world_scene_versions (scene_version),
  tick BIGINT NOT NULL CHECK (tick >= 0),
  base_block BIGINT NOT NULL CHECK (base_block >= 0),
  social_revision BIGINT NOT NULL REFERENCES social_revisions (revision),
  frame_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scene_version, tick)
);

-- Periodic simulation snapshots; the app prunes to a bounded window.
CREATE TABLE world_sim_states (
  scene_version INT NOT NULL,
  tick BIGINT NOT NULL,
  state_json JSONB NOT NULL,
  state_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scene_version, tick),
  FOREIGN KEY (scene_version, tick) REFERENCES world_ticks (scene_version, tick)
);

-- Display-layer events; origin labels keep AI/simulated data unfakeable
-- as chain facts.
CREATE TABLE world_visual_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_version INT NOT NULL,
  tick BIGINT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('CHAIN_CONFIRMED', 'OFFCHAIN_APPROVED', 'SYSTEM_SIMULATED')),
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scene_version, tick, source_id, kind),
  FOREIGN KEY (scene_version, tick) REFERENCES world_ticks (scene_version, tick)
);

COMMIT;
