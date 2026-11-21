import { DISTRICT_01 } from '@agent-republic/domain';
import type { LandmarkId, SceneManifest } from '@agent-republic/domain';

/**
 * E6-01 — WebGL capability probe and the HTML equivalent of the 3D scene.
 *
 * Both helpers are pure so they can run in Node tests. The 3D canvas is an
 * enhancement only: the directory below is the authoritative accessible view
 * and never depends on WebGL, the renderer or the simulation loop.
 */

export type WebGlProbeCanvas = {
  getContext: (contextId: string) => unknown;
};

/**
 * Returns true when the browser can create a WebGL context. Probes WebGL2
 * first, then WebGL1. Any thrown error (blocked GPU, lost context, missing
 * DOM) degrades to `false` rather than breaking the page.
 */
export function detectWebGl(createCanvas?: () => WebGlProbeCanvas | null): boolean {
  if (typeof document === 'undefined' && createCanvas === undefined) return false;

  try {
    const canvas = (createCanvas ?? (() => document.createElement('canvas')))();
    if (canvas === null) return false;
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Human-readable names for the manifest IDs. Kept out of the manifest itself. */
export const LANDMARK_LABELS: Readonly<Record<LandmarkId, string>> = {
  COUNCIL: 'Council Hall',
  IDENTITY: 'Identity Center',
  PROJECT: 'Golden Toilet Tower',
  CORE: 'Agent Core',
  PLAZA: 'Central Plaza',
};

export type WorldBuildingLink = {
  id: LandmarkId;
  label: string;
  /** Null for public spaces such as the plaza. */
  route: string | null;
  position: readonly [number, number, number];
  bounds: readonly [number, number, number];
};

/**
 * Builds the HTML directory from the scene manifest. Positions, IDs and routes
 * all come from `district-01.ts`; the web app never hard-codes them.
 */
export function buildBuildingLinks(manifest: SceneManifest = DISTRICT_01): WorldBuildingLink[] {
  return manifest.landmarks.map((landmark) => ({
    id: landmark.id,
    label: LANDMARK_LABELS[landmark.id],
    route: landmark.route,
    position: landmark.position,
    bounds: landmark.bounds,
  }));
}
