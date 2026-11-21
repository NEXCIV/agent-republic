import {
  DISTRICT_01,
  DISTRICT_01_EDGES,
  DISTRICT_01_WAYPOINTS,
  LANDMARK_ROUTES,
  WAYPOINT_IDS,
  type Landmark,
  type LandmarkId,
  type SceneManifest,
  type WaypointId,
} from './district-01.js';
import { MAX_VISIBLE_AGENTS } from '../world-v1.js';

/**
 * E5-02 scene validator (docs/3D_RENDERING.md §2.1, test R-01).
 *
 * Invariants enforced:
 *   - 40×40 ground; every landmark footprint inside x,z ∈ [-20,20]
 *   - unique landmark ids; buildings do not overlap (PLAZA is a walkable slab)
 *   - routes belong to the PRD surface set
 *   - project bindings reference existing landmarks and match genesis id 1
 *   - waypoints stay inside the ground, on y=0, outside building footprints
 *   - waypoint edges are known, non-self, non-duplicate, and fully connected
 */

export type SceneIssueCode =
  | 'GROUND'
  | 'DUPLICATE_ID'
  | 'OUT_OF_BOUNDS'
  | 'OVERLAP'
  | 'ROUTE'
  | 'BINDING'
  | 'AGENT_LIMIT'
  | 'WAYPOINT_BOUNDS'
  | 'WAYPOINT_HEIGHT'
  | 'WAYPOINT_IN_BUILDING'
  | 'EDGE_UNKNOWN'
  | 'EDGE_SELF'
  | 'EDGE_DUPLICATE'
  | 'GRAPH_DISCONNECTED';

export type SceneValidationIssue = {
  readonly code: SceneIssueCode;
  readonly message: string;
  readonly path?: string;
};

export type SceneValidationOptions = {
  /** Intersection depth (metres) still treated as touching, not overlapping. */
  readonly overlapTolerance?: number;
  /** Slack for the 40×40 boundary (metres). */
  readonly footprintTolerance?: number;
  /** Genesis project that must be bound to the PROJECT landmark. */
  readonly genesisProjectId?: string;
};

const GROUND_SIZE = 40;
const DEFAULT_GENESIS_PROJECT_ID = '1';

type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number };

function footprintOf(landmark: Landmark): Footprint {
  const [x, , z] = landmark.position;
  const [width, , depth] = landmark.bounds;
  return {
    minX: x - width / 2,
    maxX: x + width / 2,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
  };
}

function overlaps(a: Footprint, b: Footprint, tolerance: number): boolean {
  return (
    a.minX < b.maxX - tolerance &&
    b.minX < a.maxX - tolerance &&
    a.minZ < b.maxZ - tolerance &&
    b.minZ < a.maxZ - tolerance
  );
}

export function validateSceneManifest(
  manifest: SceneManifest,
  options: SceneValidationOptions = {},
): SceneValidationIssue[] {
  const issues: SceneValidationIssue[] = [];
  const overlapTolerance = options.overlapTolerance ?? 0;
  const footprintTolerance = options.footprintTolerance ?? 1e-6;
  const genesisProjectId = options.genesisProjectId ?? DEFAULT_GENESIS_PROJECT_ID;

  if (manifest.ground.width !== GROUND_SIZE || manifest.ground.depth !== GROUND_SIZE) {
    issues.push({
      code: 'GROUND',
      message: `ground must be ${GROUND_SIZE}×${GROUND_SIZE} metres, got ${manifest.ground.width}×${manifest.ground.depth}`,
      path: 'ground',
    });
  }
  if (manifest.ground.y !== 0) {
    issues.push({ code: 'GROUND', message: 'ground.y must be 0', path: 'ground.y' });
  }

  const seen = new Set<string>();
  manifest.landmarks.forEach((landmark, index) => {
    if (seen.has(landmark.id)) {
      issues.push({
        code: 'DUPLICATE_ID',
        message: `duplicate landmark id "${landmark.id}"`,
        path: `landmarks[${index}].id`,
      });
    }
    seen.add(landmark.id);
  });

  const half = GROUND_SIZE / 2;
  const footprints = new Map<LandmarkId, Footprint>();
  manifest.landmarks.forEach((landmark, index) => {
    const box = footprintOf(landmark);
    footprints.set(landmark.id, box);
    if (
      box.minX < -half - footprintTolerance ||
      box.maxX > half + footprintTolerance ||
      box.minZ < -half - footprintTolerance ||
      box.maxZ > half + footprintTolerance
    ) {
      issues.push({
        code: 'OUT_OF_BOUNDS',
        message: `landmark "${landmark.id}" footprint exceeds the ${GROUND_SIZE}m ground`,
        path: `landmarks[${index}]`,
      });
    }
    if (landmark.route !== null && !(LANDMARK_ROUTES as readonly string[]).includes(landmark.route)) {
      issues.push({
        code: 'ROUTE',
        message: `landmark "${landmark.id}" routes to an unknown surface "${landmark.route}"`,
        path: `landmarks[${index}].route`,
      });
    }
  });

  // PLAZA is a walkable slab at ground level, not a collidable building.
  const buildings = manifest.landmarks.filter((landmark) => landmark.id !== 'PLAZA');
  for (let left = 0; left < buildings.length; left += 1) {
    for (let right = left + 1; right < buildings.length; right += 1) {
      const a = buildings[left]!;
      const b = buildings[right]!;
      if (overlaps(footprintOf(a), footprintOf(b), overlapTolerance)) {
        issues.push({
          code: 'OVERLAP',
          message: `landmarks "${a.id}" and "${b.id}" overlap on the ground plane`,
          path: `landmarks.${a.id}`,
        });
      }
    }
  }

  const bindingsByProject = new Map<string, number>();
  manifest.projectBindings.forEach((binding, index) => {
    bindingsByProject.set(binding.projectId, (bindingsByProject.get(binding.projectId) ?? 0) + 1);
    if (!seen.has(binding.landmarkId)) {
      issues.push({
        code: 'BINDING',
        message: `binding references unknown landmark "${binding.landmarkId}"`,
        path: `projectBindings[${index}].landmarkId`,
      });
    }
  });

  const genesisBindings = manifest.projectBindings.filter(
    (binding) => binding.projectId === genesisProjectId,
  );
  if (genesisBindings.length !== 1 || genesisBindings[0]?.landmarkId !== 'PROJECT') {
    issues.push({
      code: 'BINDING',
      message: `project ${genesisProjectId} must be bound exactly once to the PROJECT landmark`,
      path: 'projectBindings',
    });
  }
  for (const [projectId, count] of bindingsByProject) {
    if (count > 1) {
      issues.push({
        code: 'BINDING',
        message: `project ${projectId} is bound to ${count} landmarks`,
        path: 'projectBindings',
      });
    }
  }

  if (manifest.agentMaxVisible !== MAX_VISIBLE_AGENTS) {
    issues.push({
      code: 'AGENT_LIMIT',
      message: `agentMaxVisible must be ${MAX_VISIBLE_AGENTS}`,
      path: 'agentMaxVisible',
    });
  }

  return issues;
}

export function validateWaypointGraph(
  manifest: SceneManifest,
  waypoints: Readonly<Record<WaypointId, readonly [number, number, number]>>,
  edges: ReadonlyArray<readonly [WaypointId, WaypointId]>,
  options: SceneValidationOptions = {},
): SceneValidationIssue[] {
  const issues: SceneValidationIssue[] = [];
  const footprintTolerance = options.footprintTolerance ?? 1e-6;
  const half = manifest.ground.width / 2;

  const buildingFootprints = manifest.landmarks
    .filter((landmark) => landmark.id !== 'PLAZA')
    .map((landmark) => ({ id: landmark.id, box: footprintOf(landmark) }));

  for (const id of WAYPOINT_IDS) {
    const point = waypoints[id];
    if (point === undefined) {
      issues.push({ code: 'EDGE_UNKNOWN', message: `waypoint ${id} is missing`, path: `waypoints.${id}` });
      continue;
    }
    const [x, y, z] = point;
    if (y !== 0) {
      issues.push({ code: 'WAYPOINT_HEIGHT', message: `waypoint ${id} must stay on y=0`, path: `waypoints.${id}` });
    }
    if (Math.abs(x) > half || Math.abs(z) > half) {
      issues.push({
        code: 'WAYPOINT_BOUNDS',
        message: `waypoint ${id} lies outside the ${manifest.ground.width}m ground`,
        path: `waypoints.${id}`,
      });
    }
    for (const building of buildingFootprints) {
      const inside =
        x > building.box.minX - footprintTolerance &&
        x < building.box.maxX + footprintTolerance &&
        z > building.box.minZ - footprintTolerance &&
        z < building.box.maxZ + footprintTolerance;
      if (inside) {
        issues.push({
          code: 'WAYPOINT_IN_BUILDING',
          message: `waypoint ${id} is inside landmark "${building.id}"`,
          path: `waypoints.${id}`,
        });
      }
    }
  }

  const seen = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  for (const id of WAYPOINT_IDS) adjacency.set(id, new Set());

  for (const [left, right] of edges) {
    const knownLeft = (WAYPOINT_IDS as readonly string[]).includes(left);
    const knownRight = (WAYPOINT_IDS as readonly string[]).includes(right);
    if (!knownLeft || !knownRight) {
      issues.push({
        code: 'EDGE_UNKNOWN',
        message: `edge ${left}–${right} references an unknown waypoint`,
        path: 'edges',
      });
      continue;
    }
    if (left === right) {
      issues.push({ code: 'EDGE_SELF', message: `edge ${left}–${right} is a self loop`, path: 'edges' });
      continue;
    }
    const key = left < right ? `${left}|${right}` : `${right}|${left}`;
    if (seen.has(key)) {
      issues.push({ code: 'EDGE_DUPLICATE', message: `edge ${left}–${right} is duplicated`, path: 'edges' });
      continue;
    }
    seen.add(key);
    adjacency.get(left)!.add(right);
    adjacency.get(right)!.add(left);
  }

  if (issues.every((issue) => issue.code !== 'EDGE_UNKNOWN')) {
    const start = WAYPOINT_IDS[0]!;
    const visited = new Set<string>([start]);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbour of adjacency.get(current) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    const unreachable = WAYPOINT_IDS.filter((id) => !visited.has(id));
    if (unreachable.length > 0) {
      issues.push({
        code: 'GRAPH_DISCONNECTED',
        message: `waypoints unreachable from ${start}: ${unreachable.join(', ')}`,
        path: 'edges',
      });
    }
  }

  return issues;
}

/** Validates the published District 01 constants (startup guard + test R-01). */
export function validateDistrict01(options: SceneValidationOptions = {}): SceneValidationIssue[] {
  return [
    ...validateSceneManifest(DISTRICT_01, options),
    ...validateWaypointGraph(DISTRICT_01, DISTRICT_01_WAYPOINTS, DISTRICT_01_EDGES, options),
  ];
}
