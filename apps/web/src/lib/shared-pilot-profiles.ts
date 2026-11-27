import type { SharedPilotResidentId } from '@agent-republic/domain';

export const SHARED_AVATARS = {
  citizen: { label: '城市居民', asset: 'agent-01.glb', portrait: '/nexciv-walk/citizen-01-portrait.webp' },
  builder: { label: '建设工人', asset: 'agent-02.glb', portrait: '/nexciv-walk/builder-02-portrait.webp' },
} as const;

export type SharedPilotAvatar = keyof typeof SHARED_AVATARS;
export type SharedPilotProfile = { residentId: SharedPilotResidentId; name: string; avatar: SharedPilotAvatar };
export type SharedPilotProfileView = { profile: SharedPilotProfile | null; hasKey: boolean };
export const SHARED_PILOT_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const SHARED_PILOT_SECRET = /^[A-Za-z0-9_-]{43}$/;
export const SHARED_PILOT_NAME = /^[\p{L}\p{M}\p{N} ·_-]{1,24}$/u;
