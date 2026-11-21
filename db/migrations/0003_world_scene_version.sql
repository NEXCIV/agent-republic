-- AGENT REPUBLIC — align world scene version with the protocol (task E5-05)
-- docs/WORLD_ENGINE.md fixes `sceneVersion` to 'district-01@1' (text), while
-- the E2-01 draft used INT. No production data exists yet; this migration
-- widens the column and rebuilds the dependent foreign keys.

BEGIN;

ALTER TABLE world_sim_states DROP CONSTRAINT world_sim_states_scene_version_tick_fkey;
ALTER TABLE world_visual_events DROP CONSTRAINT world_visual_events_scene_version_tick_fkey;
ALTER TABLE world_ticks DROP CONSTRAINT world_ticks_scene_version_fkey;

ALTER TABLE world_scene_versions ALTER COLUMN scene_version TYPE TEXT;
ALTER TABLE world_ticks ALTER COLUMN scene_version TYPE TEXT;
ALTER TABLE world_sim_states ALTER COLUMN scene_version TYPE TEXT;
ALTER TABLE world_visual_events ALTER COLUMN scene_version TYPE TEXT;

ALTER TABLE world_ticks
  ADD CONSTRAINT world_ticks_scene_version_fkey
  FOREIGN KEY (scene_version) REFERENCES world_scene_versions (scene_version);

ALTER TABLE world_sim_states
  ADD CONSTRAINT world_sim_states_scene_version_tick_fkey
  FOREIGN KEY (scene_version, tick) REFERENCES world_ticks (scene_version, tick);

ALTER TABLE world_visual_events
  ADD CONSTRAINT world_visual_events_scene_version_tick_fkey
  FOREIGN KEY (scene_version, tick) REFERENCES world_ticks (scene_version, tick);

COMMIT;
