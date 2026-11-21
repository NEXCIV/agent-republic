-- AGENT REPUBLIC — confirmed block timestamps (task E5-06)
-- WorldFrameV1.source carries the confirmed block timestamp, and epochId is
-- derived from it (UTC day). The indexer therefore must persist block time.

BEGIN;

ALTER TABLE chain_events ADD COLUMN block_timestamp TIMESTAMPTZ;
ALTER TABLE chain_block_hashes ADD COLUMN block_timestamp TIMESTAMPTZ;

COMMIT;
