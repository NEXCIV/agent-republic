import type { ComponentType } from 'react';
import type { LandmarkId } from '@agent-republic/domain';
import type { ProjectStage } from '@agent-republic/world-engine';
import { Core } from './Core';
import { Council } from './Council';
import { Identity } from './Identity';
import { Plaza } from './Plaza';
import { Project } from './Project';

/**
 * E6-02 — one original base-geometry component per landmark. Dimensions are
 * derived from the manifest bounds, so the web app never duplicates world
 * positions and every silhouette stays inside its published envelope.
 *
 * E6-03 adds an optional confirmed construction stage; only the PROJECT
 * building consumes it, every other model ignores it.
 */
export type BuildingBounds = readonly [number, number, number];
export type BuildingProps = { bounds: BuildingBounds; stage?: ProjectStage | null };

export const LANDMARK_BUILDINGS: Readonly<Record<LandmarkId, ComponentType<BuildingProps>>> = {
  COUNCIL: Council,
  IDENTITY: Identity,
  PROJECT: Project,
  CORE: Core,
  PLAZA: Plaza,
};
