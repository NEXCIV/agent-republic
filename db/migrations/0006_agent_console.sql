-- E3-07 agent console: track config updates and speed up history reads.

BEGIN;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS agent_configs_agent_created_idx
  ON agent_configs (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS action_intents_owner_updated_idx
  ON action_intents (owner, updated_at DESC);

COMMIT;
