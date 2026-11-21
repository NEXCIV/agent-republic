/**
 * E6-04 — local interpolation helpers for simulated agent markers.
 *
 * These are presentation-only maths: they never write positions back to the
 * frame or the server. Movement is capped at 1.4 m/s and a frame delta is
 * capped so a stalled tab cannot teleport agents across the district.
 */

export type Vec3 = readonly [number, number, number];

export const AGENT_SPEED_METRES_PER_SECOND = 1.4;

/** Longest simulated delta applied in one frame (avoids tab-resume jumps). */
export const MAX_STEP_SECONDS = 0.25;

/** Beyond this distance the client snaps to the latest frame instead of replaying. */
export const SNAP_DISTANCE_METRES = 5.6;

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/**
 * Moves `current` toward `target` by at most `speed * dt` metres.
 * Returns the target reference when the destination is reached this frame.
 */
export function stepAgentPosition(
  current: Vec3,
  target: Vec3,
  deltaSeconds: number,
  speed: number = AGENT_SPEED_METRES_PER_SECOND,
): Vec3 {
  const dt = Math.max(0, Math.min(deltaSeconds, MAX_STEP_SECONDS));
  const distance = distanceBetween(current, target);
  if (distance <= 1e-6) return target;

  const maxStep = speed * dt;
  if (distance <= maxStep) return target;

  const ratio = maxStep / distance;
  return [
    current[0] + (target[0] - current[0]) * ratio,
    current[1] + (target[1] - current[1]) * ratio,
    current[2] + (target[2] - current[2]) * ratio,
  ];
}

/** True when the client is too far behind and should adopt the latest frame. */
export function shouldSnapAgent(current: Vec3, target: Vec3): boolean {
  return distanceBetween(current, target) > SNAP_DISTANCE_METRES;
}
