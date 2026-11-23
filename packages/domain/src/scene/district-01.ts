import { z } from 'zod';

/**
 * E5-02 — District 01 static scene manifest (docs/3D_RENDERING.md §2.1).
 *
 * This is the single source of spatial truth: the web manifest endpoint, the
 * 3D renderer and the world reducer all read these values. Buildings point at
 * PRD routes; project bindings must match the contract's genesis parameters.
 */

export const LANDMARK_IDS = ['COUNCIL', 'IDENTITY', 'PROJECT', 'CORE', 'PLAZA'] as const;
export type LandmarkId = (typeof LANDMARK_IDS)[number];

/** Routes that a landmark may bind to (docs/PRD.md surfaces). */
export const LANDMARK_ROUTES = [
  '/council',
  '/identity',
  '/projects',
  '/projects/1',
  '/my-agent',
] as const;
export type LandmarkRoute = (typeof LANDMARK_ROUTES)[number];

const positionSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

const boundsSchema = z.tuple([
  z.number().finite().positive(),
  z.number().finite().positive(),
  z.number().finite().positive(),
]);

export const landmarkSchema = z
  .object({
    id: z.enum(LANDMARK_IDS),
    position: positionSchema,
    /** [width, height, depth] in metres; the ground footprint uses x/z. */
    bounds: boundsSchema,
    route: z.enum(LANDMARK_ROUTES).nullable(),
  })
  .strict();

export type Landmark = z.infer<typeof landmarkSchema>;

export const projectBindingSchema = z
  .object({
    projectId: z.string().regex(/^\d+$/),
    landmarkId: z.enum(LANDMARK_IDS),
  })
  .strict();

export const sceneManifestSchema = z
  .object({
    schemaVersion: z.literal('1.1'),
    sceneVersion: z.literal('district-01@1'),
    ground: z
      .object({
        width: z.number().finite().positive(),
        depth: z.number().finite().positive(),
        y: z.number().finite(),
      })
      .strict(),
    landmarks: z.array(landmarkSchema),
    projectBindings: z.array(projectBindingSchema),
    agentMaxVisible: z.number().int().positive(),
  })
  .strict();

export type SceneManifest = z.infer<typeof sceneManifestSchema>;

/** The canonical District 01 layout. Published versions are immutable. */
export const DISTRICT_01: SceneManifest = {
  schemaVersion: '1.1',
  sceneVersion: 'district-01@1',
  ground: { width: 40, depth: 40, y: 0 },
  landmarks: [
    { id: 'COUNCIL', position: [-9, 0, -6], bounds: [7, 9, 7], route: '/council' },
    { id: 'IDENTITY', position: [9, 0, -6], bounds: [7, 11, 7], route: '/identity' },
    { id: 'PROJECT', position: [-8, 0, 9], bounds: [9, 14, 9], route: '/projects' },
    { id: 'CORE', position: [9, 0, 9], bounds: [7, 10, 7], route: '/my-agent' },
    { id: 'PLAZA', position: [0, 0, 0], bounds: [7, 0.1, 7], route: null },
  ],
  projectBindings: [{ projectId: '1', landmarkId: 'PROJECT' }],
  agentMaxVisible: 30,
};

/**
 * E5-02 — fixed waypoint graph (docs/WORLD_ENGINE.md §4).
 * Movement is one adjacent hop per tick; no free-form coordinates, no A*.
 * P9..P12 sit just OUTSIDE the four building entrances.
 */
export const WAYPOINT_IDS = [
  'P0',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
  'P9',
  'P10',
  'P11',
  'P12',
] as const;
export type WaypointId = (typeof WAYPOINT_IDS)[number];
/** The shared entrance graph is used by both private trips and world simulation. */
export const LANDMARK_WAYPOINTS = {
  PLAZA: 'P0', COUNCIL: 'P9', IDENTITY: 'P10', PROJECT: 'P11', CORE: 'P12',
} as const satisfies Record<LandmarkId, WaypointId>;

export const DISTRICT_01_WAYPOINTS: Readonly<Record<WaypointId, readonly [number, number, number]>> = {
  P0: [0, 0, 0],
  P1: [-4, 0, 0],
  P2: [4, 0, 0],
  P3: [0, 0, -4],
  P4: [0, 0, 4],
  P5: [-4, 0, -4],
  P6: [4, 0, -4],
  P7: [-4, 0, 4],
  P8: [4, 0, 4],
  P9: [-9, 0, -1],
  P10: [9, 0, -1],
  P11: [-8, 0, 3],
  P12: [9, 0, 4],
};

export const DISTRICT_01_EDGES: ReadonlyArray<readonly [WaypointId, WaypointId]> = [
  ['P0', 'P1'],
  ['P0', 'P2'],
  ['P0', 'P3'],
  ['P0', 'P4'],
  ['P1', 'P5'],
  ['P1', 'P7'],
  ['P2', 'P6'],
  ['P2', 'P8'],
  ['P3', 'P5'],
  ['P3', 'P6'],
  ['P4', 'P7'],
  ['P4', 'P8'],
  ['P1', 'P9'],
  ['P2', 'P10'],
  ['P7', 'P11'],
  ['P8', 'P12'],
];
