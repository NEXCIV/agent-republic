-- AGENT REPUBLIC — reorg-aware world ticks (task E5-07)
-- A tick is only valid if the block it was built on is still canonical.
-- Storing the hash (not just the number) makes that check exact after a fork.

BEGIN;

ALTER TABLE world_ticks ADD COLUMN base_block_hash hex_hash66;

COMMIT;
