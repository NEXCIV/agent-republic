import { createHash } from 'node:crypto';
import {
  DISTRICT_01,
  validateDistrict01,
  type SceneManifest,
  type SceneValidationIssue,
} from '@agent-republic/domain';
import { canonicalize } from './frame-id.js';

/**
 * E5-06 scene manifest endpoint payload (docs/WORLD_ENGINE.md §8,
 * docs/3D_RENDERING.md §2.1): the published layout plus a content hash the
 * renderer can compare against its bundled copy.
 */

export type SceneManifestPayload = SceneManifest & { readonly manifestHash: string };

export class SceneManifestError extends Error {
  constructor(
    message: string,
    readonly issues: readonly SceneValidationIssue[] = [],
  ) {
    super(`[scene-manifest] ${message}`);
    this.name = 'SceneManifestError';
  }
}

export function sceneManifestHash(manifest: SceneManifest = DISTRICT_01): string {
  return `sha256:${createHash('sha256').update(canonicalize(manifest), 'utf8').digest('hex')}`;
}

/** Validated payload served to clients; refuses to publish an invalid scene. */
export function getSceneManifest(): SceneManifestPayload {
  const issues = validateDistrict01();
  if (issues.length > 0) {
    throw new SceneManifestError('district-01 manifest failed validation', issues);
  }
  return { ...DISTRICT_01, manifestHash: sceneManifestHash(DISTRICT_01) };
}
