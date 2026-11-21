import { describe, expect, it } from 'vitest';
import {
  DISTRICT_01,
  DISTRICT_01_EDGES,
  DISTRICT_01_WAYPOINTS,
  sceneManifestSchema,
  validateDistrict01,
  validateSceneManifest,
  validateWaypointGraph,
  type SceneManifest,
  type WaypointId,
} from '../src/index.js';

/**
 * E5-02 scene tests (R-01). A bad manifest would bind clicks to the wrong
 * project or place agents inside walls, so every invariant is exercised.
 */

const clone = (): SceneManifest => structuredClone(DISTRICT_01);
const codes = (issues: { code: string }[]): string[] => issues.map((issue) => issue.code);

describe('DISTRICT_01 canonical manifest', () => {
  it('parses with the published schema', () => {
    const parsed = sceneManifestSchema.parse(DISTRICT_01);
    expect(parsed.sceneVersion).toBe('district-01@1');
    expect(parsed.landmarks).toHaveLength(5);
  });

  it('passes every manifest and waypoint invariant', () => {
    expect(validateDistrict01()).toEqual([]);
  });

  it('keeps all waypoints on the ground plane and outside buildings', () => {
    for (const id of Object.keys(DISTRICT_01_WAYPOINTS) as WaypointId[]) {
      const [, y] = DISTRICT_01_WAYPOINTS[id];
      expect(y).toBe(0);
    }
    expect(codes(validateWaypointGraph(DISTRICT_01, DISTRICT_01_WAYPOINTS, DISTRICT_01_EDGES))).toEqual([]);
  });

  it('rejects unknown landmark routes at parse time', () => {
    const manifest = clone();
    manifest.landmarks[0] = { ...manifest.landmarks[0]!, route: '/evil' as never };
    expect(sceneManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

describe('validateSceneManifest', () => {
  it('rejects duplicate landmark ids', () => {
    const manifest = clone();
    manifest.landmarks.push({ ...manifest.landmarks[0]! });
    expect(codes(validateSceneManifest(manifest))).toContain('DUPLICATE_ID');
  });

  it('rejects a footprint outside the 40m ground', () => {
    const manifest = clone();
    manifest.landmarks[0] = { ...manifest.landmarks[0]!, position: [-18, 0, -6] };
    expect(codes(validateSceneManifest(manifest))).toContain('OUT_OF_BOUNDS');
  });

  it('rejects overlapping buildings', () => {
    const manifest = clone();
    manifest.landmarks[1] = { ...manifest.landmarks[1]!, position: [-9, 0, -6] };
    expect(codes(validateSceneManifest(manifest))).toContain('OVERLAP');
  });

  it('honours the overlap tolerance', () => {
    const manifest = clone();
    // ~0.4m intersection between COUNCIL and IDENTITY footprints.
    manifest.landmarks[1] = { ...manifest.landmarks[1]!, position: [-2.4, 0, -6] };
    expect(codes(validateSceneManifest(manifest))).toContain('OVERLAP');
    expect(codes(validateSceneManifest(manifest, { overlapTolerance: 0.5 }))).not.toContain('OVERLAP');
  });

  it('rejects a non-40m ground', () => {
    const manifest = clone();
    manifest.ground = { width: 60, depth: 40, y: 0 };
    expect(codes(validateSceneManifest(manifest))).toContain('GROUND');
  });

  it('rejects bindings to unknown landmarks', () => {
    const manifest = clone();
    manifest.projectBindings = [{ projectId: '1', landmarkId: 'CORE' }];
    const issues = validateSceneManifest(manifest);
    expect(codes(issues)).toContain('BINDING');
  });

  it('requires the genesis project to bind to PROJECT', () => {
    const manifest = clone();
    manifest.projectBindings = [{ projectId: '2', landmarkId: 'PROJECT' }];
    expect(codes(validateSceneManifest(manifest))).toContain('BINDING');
  });

  it('pins the visible agent cap to 30', () => {
    const manifest = clone();
    manifest.agentMaxVisible = 31;
    expect(codes(validateSceneManifest(manifest))).toContain('AGENT_LIMIT');
  });
});

describe('validateWaypointGraph', () => {
  const withWaypoints = (overrides: Partial<Record<WaypointId, readonly [number, number, number]>>) => ({
    ...DISTRICT_01_WAYPOINTS,
    ...overrides,
  });

  it('rejects a waypoint outside the ground', () => {
    const issues = validateWaypointGraph(
      DISTRICT_01,
      withWaypoints({ P12: [25, 0, 4] }),
      DISTRICT_01_EDGES,
    );
    expect(codes(issues)).toContain('WAYPOINT_BOUNDS');
  });

  it('rejects a waypoint inside a building footprint', () => {
    const issues = validateWaypointGraph(
      DISTRICT_01,
      withWaypoints({ P0: [-9, 0, -6] }),
      DISTRICT_01_EDGES,
    );
    expect(codes(issues)).toContain('WAYPOINT_IN_BUILDING');
  });

  it('rejects a raised waypoint', () => {
    const issues = validateWaypointGraph(
      DISTRICT_01,
      withWaypoints({ P4: [0, 1, 4] }),
      DISTRICT_01_EDGES,
    );
    expect(codes(issues)).toContain('WAYPOINT_HEIGHT');
  });

  it('rejects unknown edges, self loops and duplicates', () => {
    const unknown = validateWaypointGraph(DISTRICT_01, DISTRICT_01_WAYPOINTS, [
      ...DISTRICT_01_EDGES,
      ['P0', 'P99' as WaypointId],
    ]);
    expect(codes(unknown)).toContain('EDGE_UNKNOWN');

    const selfLoop = validateWaypointGraph(DISTRICT_01, DISTRICT_01_WAYPOINTS, [
      ...DISTRICT_01_EDGES,
      ['P1', 'P1'],
    ]);
    expect(codes(selfLoop)).toContain('EDGE_SELF');

    const duplicate = validateWaypointGraph(DISTRICT_01, DISTRICT_01_WAYPOINTS, [
      ...DISTRICT_01_EDGES,
      ['P1', 'P0'],
    ]);
    expect(codes(duplicate)).toContain('EDGE_DUPLICATE');
  });

  it('rejects a disconnected graph', () => {
    const pruned = DISTRICT_01_EDGES.filter(
      ([left, right]) => !((left === 'P8' && right === 'P12') || (left === 'P12' && right === 'P8')),
    );
    const issues = validateWaypointGraph(DISTRICT_01, DISTRICT_01_WAYPOINTS, pruned);
    expect(codes(issues)).toContain('GRAPH_DISCONNECTED');
  });
});
