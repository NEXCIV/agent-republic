import { describe, expect, it } from 'vitest';
import { SHARED_PILOT_PLACE_IDS, SHARED_PILOT_PROVENANCE, SHARED_PILOT_RESIDENT_IDS, sharedPilotMoveRequestSchema } from '../src/index.js';

const request = {
  requestId: 'da2a730e-0c4b-4a0c-93d7-e0cd45fa6b7e',
  action: 'moveTo',
  destination: { place: 'cafe' },
};

describe('shared city DEMO move request', () => {
  it('requires a server-owned resident and a fixed pilot place vocabulary', () => {
    expect(SHARED_PILOT_RESIDENT_IDS).toEqual(['01', '02']);
    expect(SHARED_PILOT_PLACE_IDS).toEqual(['cafe', 'plaza', 'governance', 'works', 'pier']);
    expect(SHARED_PILOT_PROVENANCE).toBe('AI_SIMULATED');
    for (const place of SHARED_PILOT_PLACE_IDS) {
      const command = { ...request, destination: { place } };
      expect(sharedPilotMoveRequestSchema.parse(command)).toEqual(command);
    }
  });

  it('rejects client-supplied identity and credential fields', () => {
    for (const extra of [
      { resident: '01' }, { residentId: '02' }, { actor: '02' }, { owner: '0x' + 'ab'.repeat(20) },
      { appUserId: request.requestId }, { token: 'secret' }, { role: 'admin' },
    ]) {
      expect(sharedPilotMoveRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    }
  });

  it('rejects client-supplied route, timing, or outcome', () => {
    for (const extra of [
      { arrival: 1 }, { arrivesAt: 1 }, { duration: 1 }, { completed: true }, { result: 'COMPLETED' },
      { coordinates: { x: 1, z: 2 } }, { x: 1, z: 2 }, { position: [1, 2] },
      { destination: { place: 'cafe', x: 1, z: 2 } }, { destination: { place: 'cafe', arrivesAt: 1 } },
      { destination: { x: 1, z: 2 } }, { destination: { place: 'market' } },
    ]) {
      expect(sharedPilotMoveRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    }
  });

  it('only accepts the one named DEMO movement action', () => {
    for (const action of ['move_to', 'interactCity', 'castVote', 'contribute', 'publishNote', null]) {
      expect(sharedPilotMoveRequestSchema.safeParse({ ...request, action }).success).toBe(false);
    }
    for (const invalid of [undefined, null, {}, [], { ...request, action: undefined }, { ...request, destination: undefined }]) {
      expect(sharedPilotMoveRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('requires a v4 UUID request key, and canonicalizes letter case for retries', () => {
    for (const requestId of ['not-uuid', 'da2a730e-0c4b-1a0c-93d7-e0cd45fa6b7e', 'da2a730e-0c4b-4a0c-03d7-e0cd45fa6b7e', 1, null]) {
      expect(sharedPilotMoveRequestSchema.safeParse({ ...request, requestId }).success).toBe(false);
    }
    expect(sharedPilotMoveRequestSchema.parse({ ...request, requestId: request.requestId.toUpperCase() }).requestId).toEqual(request.requestId);
  });
});
