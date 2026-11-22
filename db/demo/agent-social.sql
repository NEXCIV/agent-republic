-- Explicit DEMO initialization. This file is outside the live migration directory.
CREATE TABLE IF NOT EXISTS demo_social_pauses (
  agent_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS demo_social_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED', 'DECLINED', 'CANCELLED', 'COMPLETED')),
  invited_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  reason TEXT,
  recalled_session_id UUID REFERENCES demo_social_sessions (id),
  messages JSONB NOT NULL DEFAULT '[]',
  memories JSONB NOT NULL DEFAULT '[]',
  CHECK (inviter_id <> recipient_id),
  CHECK ((status = 'INVITED') = (resolved_at IS NULL)),
  CHECK (resolved_at >= invited_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS demo_social_one_invite
  ON demo_social_sessions (status) WHERE status = 'INVITED';

CREATE INDEX IF NOT EXISTS demo_social_recent
  ON demo_social_sessions (invited_at DESC, id DESC);
