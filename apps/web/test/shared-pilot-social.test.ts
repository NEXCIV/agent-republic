import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHARED_PILOT_LINES, sharedPilotSocialRequestSchema } from '@agent-republic/domain';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';
import { SharedPilotRuntime } from '../src/lib/shared-pilot-runtime';
import { meetingPoint, nextSpeaker } from '../src/lib/shared-pilot-social';

const START = 1_800_000_000_000;
const move = (place: 'cafe' | 'works', requestId = randomUUID()) => ({ requestId, action: 'moveTo', destination: { place } });
const invite = (requestId = randomUUID()) => ({ requestId, action: 'invite', target: '02', venue: 'cafe' });
const respond = (meetingId: string, decision: 'accept' | 'decline', requestId = randomUUID()) => ({ requestId, action: 'respond', meetingId, decision });
const say = (meetingId: string, line: string, requestId = randomUUID()) => ({ requestId, action: 'say', meetingId, line });

describe.skipIf(!process.getBuiltinModule?.('node:sqlite'))('shared café social loop', () => {
  let folder: string, file: string, at: number;
  let store: SharedPilotStore | undefined;
  beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'nexciv-social-')); file = join(folder, 'shared.sqlite'); at = START; });
  afterEach(() => { store?.close(); store = undefined; rmSync(folder, { recursive: true, force: true }); });
  function open() { return store = new SharedPilotStore(file, () => at); }
  function setup() { const s = open(); return { s, a: s.issueCredential('01').token, b: s.issueCredential('02').token }; }
  function reopen() { store!.close(); store = undefined; return open(); }

  it('rejects spoofed actors/free text, requires the invitee, supports rejection and idempotent replay', () => {
    const { s, a, b } = setup();
    const input = invite();
    expect(sharedPilotSocialRequestSchema.safeParse({ ...input, actor: '02' }).success).toBe(false);
    expect(sharedPilotSocialRequestSchema.safeParse({ ...say(randomUUID(), 'greet'), text: 'free text' }).success).toBe(false);
    expect(() => s.socialAction('', input)).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    const first = s.socialAction(a, input);
    expect(s.socialAction(a, input)).toEqual(first);
    expect(() => s.socialAction(a, respond(first.meetingId, 'accept'))).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => s.moveTo(a, move('works', input.requestId))).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    const rejection = respond(first.meetingId, 'decline');
    s.socialAction(b, rejection);
    expect(s.observe(a).social.meeting?.status).toBe('declined');
    expect(s.observe(b).privateSocial.encounters).toBe(0);
    expect(() => s.socialAction(b, { ...rejection, decision: 'accept' })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(s.observe(a).social.events.map(({ kind }) => kind)).toEqual(['INVITED', 'DECLINED']);
  });

  it('travels independently, starts only at both distinct points, records real turns and commits memories once after restart', () => {
    const { s, a, b } = setup();
    const { meetingId } = s.socialAction(a, invite());
    s.socialAction(b, respond(meetingId, 'accept'));
    expect(s.observe(a).social.meeting?.status).toBe('accepted');
    expect(() => s.moveTo(a, move('works'))).toThrowError(expect.objectContaining({ code: 'BUSY' }));
    const one = s.moveTo(a, move('cafe'));
    const two = s.moveTo(b, move('cafe'));
    const arrivals = [one.arrivesAt, two.arrivesAt];
    at = Math.min(...arrivals);
    expect(s.observe(a).social.arrived).toHaveLength(1);
    expect(s.observe(a).social.meeting?.status).toBe('accepted');
    at = Math.max(...arrivals);
    let active = s.observe(a);
    expect(active.social.meeting?.status).toBe('talking');
    expect(active.social.arrived).toEqual(['01', '02']);
    for (const resident of active.residents) expect(resident.position.map(x => Number(x.toFixed(4)))).toEqual(meetingPoint(resident.residentId).map(x => Number(x.toFixed(4))));
    const distance = Math.hypot(...active.residents[0]!.position.map((x, i) => x - active.residents[1]!.position[i]!));
    expect(distance).toBeGreaterThan(1.3);
    expect(() => s.socialAction(a, say(meetingId, 'greet'))).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    at = active.social.meeting!.nextTurnAt;
    expect(() => s.socialAction(b, say(meetingId, 'greet'))).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => s.moveTo(a, move('cafe'))).toThrowError(expect.objectContaining({ code: 'BUSY' }));
    let reopened = reopen();
    for (const line of SHARED_PILOT_LINES) {
      active = reopened.observe(a);
      at = active.social.meeting!.nextTurnAt;
      const token = nextSpeaker(active.social.meeting!) === '01' ? a : b;
      const action = say(meetingId, line);
      const accepted = reopened.socialAction(token, action);
      expect(reopened.socialAction(token, action)).toEqual(accepted);
    }
    active = reopened.observe(a);
    expect(active.social.meeting?.lines.map(({ residentId }) => residentId)).toEqual(['01', '02', '01', '02']);
    expect(active.privateSocial.encounters).toBe(0);
    at = active.social.meeting!.nextTurnAt;
    reopened = reopen();
    const completed = reopened.observe(a);
    expect(completed.social.meeting?.status).toBe('completed');
    expect(completed.social.completedMeetings).toBe(1);
    expect(completed.privateSocial.memories[0]).toMatchObject({ other: '02', meetingId });
    expect(reopened.observe(b).privateSocial.memories[0]).toMatchObject({ other: '01', meetingId });
    expect(reopened.observe(b).social).toEqual(completed.social);
    expect(JSON.stringify(completed.social)).not.toContain('memories');
    expect(completed.social.events.filter(({ kind }) => kind === 'COMPLETED')).toHaveLength(1);
    const next = reopened.moveTo(a, move('works'));
    expect(next.status).toBe('ACCEPTED');
    expect(reopened.observe(a).residents[0]!.position).toEqual(completed.residents[0]!.position);
  });

  it('expires unanswered or unfulfilled meetings without memories', () => {
    const { s, a, b } = setup();
    s.socialAction(a, invite());
    at += 30000;
    expect(s.observe(a).social.meeting?.status).toBe('expired');
    const { meetingId } = s.socialAction(a, invite());
    s.socialAction(b, respond(meetingId, 'accept'));
    at += 120000;
    expect(s.observe(a).social.meeting?.status).toBe('expired');
    expect(s.observe(a).privateSocial.encounters).toBe(0);
    expect(s.observe(b).privateSocial.memories).toEqual([]);
  });

  it('migrates the exact v1 pilot schema without losing prior movement or credentials', () => {
    const { s, a, b } = setup();
    const sent = s.moveTo(a, move('works'));
    s.close(); store = undefined;
    const sqlite = process.getBuiltinModule!('node:sqlite') as typeof import('node:sqlite');
    const db = new sqlite.DatabaseSync(file);
    // This database is a fresh temporary fixture; simulate the old schema only.
    db.exec('DROP TABLE shared_pilot_survey; DROP TABLE shared_pilot_social; PRAGMA user_version=1;'); db.close();
    const migrated = open();
    expect(migrated.receipt(a, sent.requestId)).toEqual(sent);
    expect(migrated.observe(b).social.events).toEqual([]);
    expect(migrated.observe(b).residents[0]!.movement?.destination.place).toBe('works');
  });

  it('runs the two separate rule clients through the complete social loop without browser actions', () => {
    const runtime = new SharedPilotRuntime(file, () => at);
    try {
      for (let i = 0; i < 130; i++) {
        at = START + i * 1000;
        runtime.tick();
        if (runtime.snapshot().social.completedMeetings > 0) break;
      }
      const result = runtime.snapshot();
      expect(result.social.completedMeetings).toBe(1);
      expect(result.social.events.map(({ kind }) => kind)).toEqual(['INVITED', 'ACCEPTED', 'MEETING_STARTED', 'SAID', 'SAID', 'SAID', 'SAID', 'COMPLETED']);
      expect(result).not.toHaveProperty('privateSocial');
      expect(JSON.stringify(result)).not.toContain('nxc_shared_');
    } finally { runtime.close(); }
  });
});
