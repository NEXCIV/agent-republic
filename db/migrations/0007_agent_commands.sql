-- E3-07: owner-private, off-chain command journal and restartable work queue.
BEGIN;

CREATE TABLE agent_commands (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  agent_id UUID NOT NULL REFERENCES agents (id),
  app_user_id UUID NOT NULL REFERENCES app_users (id),
  config_version INT NOT NULL,
  request_id UUID NOT NULL,
  command_text TEXT NOT NULL CHECK (char_length(command_text) BETWEEN 1 AND 500),
  mode TEXT NOT NULL CHECK (mode IN ('SUGGEST', 'EXECUTE', 'INTERRUPT')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'PAUSED', 'DECLINED', 'COMPLETED', 'FAILED')),
  steps JSONB NOT NULL,
  results JSONB NOT NULL,
  report TEXT,
  source_block NUMERIC(78, 0) NOT NULL CHECK (source_block >= 0),
  source_block_hash hex_hash66,
  world_frame_id hex_hash66 NOT NULL,
  revision INT NOT NULL CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (agent_id, config_version) REFERENCES agent_configs (agent_id, version),
  UNIQUE (agent_id, app_user_id, request_id)
);

CREATE UNIQUE INDEX agent_commands_running_idx
  ON agent_commands (agent_id, app_user_id) WHERE status = 'RUNNING';
CREATE INDEX agent_commands_pending_idx
  ON agent_commands (next_attempt_at, seq) WHERE status = 'RUNNING';
CREATE INDEX agent_commands_history_idx ON agent_commands (agent_id, app_user_id, seq DESC);

CREATE TABLE agent_command_locations (
  agent_id UUID NOT NULL REFERENCES agents (id),
  app_user_id UUID NOT NULL REFERENCES app_users (id),
  location TEXT NOT NULL CHECK (location IN ('PLAZA', 'COUNCIL', 'IDENTITY', 'PROJECT', 'CORE')),
  PRIMARY KEY (agent_id, app_user_id)
);

ALTER TABLE llm_usage ADD COLUMN call_kind TEXT
  CHECK (call_kind IN ('MAIN_DECISION', 'DEBATE_REPLY', 'REFLECTION'));
CREATE INDEX llm_usage_kind_day_idx ON llm_usage (created_at)
  WHERE call_kind IS NOT NULL;

COMMIT;
