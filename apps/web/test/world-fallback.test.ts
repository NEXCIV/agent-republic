import { describe, expect, it } from 'vitest';
import { DISTRICT_01, LANDMARK_IDS, LANDMARK_ROUTES } from '@agent-republic/domain';
import { buildBuildingLinks, detectWebGl, LANDMARK_LABELS } from '../src/features/world-3d/webgl';

/**
 * E6-01 — WebGL probe and HTML fallback contract.
 *
 * The 3D canvas may fail at any point; these tests pin the pure logic that
 * decides when to fall back and the directory that must always match the
 * published scene manifest.
 */

function fakeCanvas(contexts: Record<string, unknown>) {
  const requested: string[] = [];
  const create = () => ({
    getContext(contextId: string) {
      requested.push(contextId);
      return contexts[contextId] ?? null;
    },
  });
  return { create, requested };
}

describe('detectWebGl', () => {
  it('returns false without a DOM or a canvas factory', () => {
    expect(typeof document).toBe('undefined');
    expect(detectWebGl()).toBe(false);
  });

  it('accepts WebGL2 and probes it first', () => {
    const { create, requested } = fakeCanvas({ webgl2: {} });
    expect(detectWebGl(create)).toBe(true);
    expect(requested).toEqual(['webgl2']);
  });

  it('falls back to WebGL1 when WebGL2 is missing', () => {
    const { create, requested } = fakeCanvas({ webgl: {} });
    expect(detectWebGl(create)).toBe(true);
    expect(requested).toEqual(['webgl2', 'webgl']);
  });

  it('returns false when no context can be created', () => {
    const { create } = fakeCanvas({});
    expect(detectWebGl(create)).toBe(false);
  });

  it('returns false when the canvas cannot be created', () => {
    expect(detectWebGl(() => null)).toBe(false);
  });

  it('returns false when probing throws', () => {
    expect(
      detectWebGl(() => {
        throw new Error('GPU blocked');
      }),
    ).toBe(false);
  });
});

describe('buildBuildingLinks', () => {
  it('mirrors every landmark in the scene manifest', () => {
    const links = buildBuildingLinks();

    expect(links.map((link) => link.id)).toEqual(DISTRICT_01.landmarks.map((landmark) => landmark.id));
    expect(links).toHaveLength(LANDMARK_IDS.length);

    for (const landmark of DISTRICT_01.landmarks) {
      const link = links.find((entry) => entry.id === landmark.id);
      expect(link).toBeDefined();
      expect(link?.route).toBe(landmark.route);
      expect(link?.position).toEqual(landmark.position);
      expect(link?.bounds).toEqual(landmark.bounds);
      expect(link?.label).toBe(LANDMARK_LABELS[landmark.id]);
    }
  });

  it('keeps the plaza as a public space and links the four buildings to PRD routes', () => {
    const links = buildBuildingLinks();
    const plaza = links.find((link) => link.id === 'PLAZA');

    expect(plaza?.route).toBeNull();
    for (const link of links) {
      if (link.id === 'PLAZA') continue;
      expect(link.route).not.toBeNull();
      expect(LANDMARK_ROUTES).toContain(link.route);
    }
  });

  it('copies routes from a supplied manifest instead of hard-coding them', () => {
    const custom = {
      ...DISTRICT_01,
      landmarks: DISTRICT_01.landmarks.map((landmark) =>
        landmark.id === 'CORE' ? { ...landmark, route: '/projects/1' as const } : landmark,
      ),
    };

    const links = buildBuildingLinks(custom);
    expect(links.find((link) => link.id === 'CORE')?.route).toBe('/projects/1');
  });

  it('returns an empty directory for an empty manifest', () => {
    expect(buildBuildingLinks({ ...DISTRICT_01, landmarks: [] })).toEqual([]);
  });
});
