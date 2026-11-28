import type { SharedPilotResidentId } from '@agent-republic/domain';

export const SHARED_AVATARS = {
  citizen: { label: '城市居民（男）', asset: 'agent-01.glb', portrait: '/nexciv-walk/portraits/agent-01-front.webp' },
  builder: { label: '建设工人', asset: 'agent-02.glb', portrait: '/nexciv-walk/portraits/agent-02-front.webp' },
  researcher: { label: '研究人员', asset: 'agent-03.glb', portrait: '/nexciv-walk/portraits/agent-03-front.webp' },
  'creator-male': { label: '创意青年', asset: 'agent-04.glb', portrait: '/nexciv-walk/portraits/agent-04-front.webp' },
  'citizen-female': { label: '城市居民（女）', asset: 'agent-05.glb', portrait: '/nexciv-walk/portraits/agent-05-front.webp' },
  service: { label: '商业服务', asset: 'agent-06.glb', portrait: '/nexciv-walk/portraits/agent-06-front.webp' },
  'creator-female': { label: '创意居民', asset: 'agent-07.glb', portrait: '/nexciv-walk/portraits/agent-07-front.webp' },
  technician: { label: '城市技术员', asset: 'agent-08.glb', portrait: '/nexciv-walk/portraits/agent-08-front.webp' },
} as const;

export type SharedPilotAvatar = keyof typeof SHARED_AVATARS;
export function isSharedPilotAvatar(value: unknown): value is SharedPilotAvatar {
  return typeof value === 'string' && Object.hasOwn(SHARED_AVATARS, value);
}

export type SharedPilotProfile = { residentId: SharedPilotResidentId; name: string; avatar: SharedPilotAvatar };
export type SharedPilotProfileView = { profile: SharedPilotProfile | null; hasKey: boolean };

export function latestResidentActivity<T extends { residentId: SharedPilotResidentId }>(entries: readonly T[], id: SharedPilotResidentId) {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.residentId === id) return entry;
  }
}
export const SHARED_PILOT_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const SHARED_PILOT_SECRET = /^[A-Za-z0-9_-]{43}$/;
export const SHARED_PILOT_NAME = /^[\p{L}\p{M}\p{N} ·_-]{1,24}$/u;
