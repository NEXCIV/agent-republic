-- AGENT REPUBLIC — chain indexer support (task E2-02)
-- Source of truth: docs/ARCHITECTURE.md §6.1, docs/WORLD_ENGINE.md §6.
--
-- Adds:
--   * chain_block_hashes: per-block hash ledger used to detect reorgs by
--     comparing stored hashes with fresh RPC hashes (ARCHITECTURE §6.1).
--   * chain_events.confirmed_at_block: set once a block is at or below the
--     configured finality depth. Projections must only read rows where this
--     is NOT NULL — an included-but-unconfirmed tx never counts
--     (WORLD_ENGINE §2: SUBMITTED/INCLUDED must not advance BUILD/REP).
--   * chain_events.orphaned_at: audit timestamp for reorg rollback.

BEGIN;

CREATE TABLE chain_block_hashes (
  chain_id INT NOT NULL CHECK (chain_id IN (56, 97)),
  block_number BIGINT NOT NULL CHECK (block_number >= 0),
  block_hash hex_hash66 NOT NULL,
  parent_hash hex_hash66 NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_number)
);

ALTER TABLE chain_events
  ADD COLUMN confirmed_at_block BIGINT
    CHECK (confirmed_at_block IS NULL OR confirmed_at_block >= block_number),
  ADD COLUMN orphaned_at TIMESTAMPTZ;

-- Projection reads: confirmed, non-orphaned events in chain order.
CREATE INDEX chain_events_confirmed_idx
  ON chain_events (chain_id, block_number, log_index)
  WHERE status = 'INCLUDED';

COMMIT;
