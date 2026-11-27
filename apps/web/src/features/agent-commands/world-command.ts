import { LANDMARK_IDS, type LandmarkId } from '@agent-republic/domain';
import { LANDMARK_LABELS } from '../world-3d/webgl';

export function commandLink(kind: 'visit' | 'meet', id: string): string {
  return `/agent-console?${kind}=${encodeURIComponent(id)}#command-title`;
}

export function draftFromWorld(visit: string | null, meet: string | null): string {
  if (visit && (LANDMARK_IDS as readonly string[]).includes(visit)) {
    return `Visit ${LANDMARK_LABELS[visit as LandmarkId]} and report back.`;
  }
  if (meet && /^[A-Za-z0-9_.-]{1,64}$/.test(meet)) {
    return `Talk to ${meet} about public projects and report back.`;
  }
  return '';
}
