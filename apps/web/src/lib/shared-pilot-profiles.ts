import type { SharedPilotResidentId } from '@agent-republic/domain';

export const SHARED_AVATARS = {
  citizen: { label: '城市居民（男）', asset: 'agent-01.glb', portrait: '/nexciv-walk/citizen-01-portrait.webp' },
  builder: { label: '建设工人', asset: 'agent-02.glb', portrait: '/nexciv-walk/builder-02-portrait.webp' },
  researcher: { label: '研究人员', asset: 'agent-03.glb', portrait: '/nexciv-walk/agent-03-portrait.webp' },
  'creator-male': { label: '创意青年', asset: 'agent-04.glb', portrait: '/nexciv-walk/agent-04-portrait.webp' },
  'citizen-female': { label: '城市居民（女）', asset: 'agent-05.glb', portrait: '/nexciv-walk/agent-05-portrait.webp' },
  service: { label: '商业服务', asset: 'agent-06.glb', portrait: '/nexciv-walk/agent-06-portrait.webp' },
  'creator-female': { label: '创意居民', asset: 'agent-07.glb', portrait: '/nexciv-walk/agent-07-portrait.webp' },
  technician: { label: '城市技术员', asset: 'agent-08.glb', portrait: '/nexciv-walk/agent-08-portrait.webp' },
} as const;

export type SharedPilotAvatar = keyof typeof SHARED_AVATARS;
export function isSharedPilotAvatar(value: unknown): value is SharedPilotAvatar {
  return typeof value === 'string' && Object.hasOwn(SHARED_AVATARS, value);
}

export type SharedPilotProfile = { residentId: SharedPilotResidentId; name: string; avatar: SharedPilotAvatar };
export type SharedPilotProfileView = { profile: SharedPilotProfile | null; hasKey: boolean };
export const SHARED_PILOT_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const SHARED_PILOT_SECRET = /^[A-Za-z0-9_-]{43}$/;
export const SHARED_PILOT_NAME = /^[\p{L}\p{M}\p{N} ·_-]{1,24}$/u;
