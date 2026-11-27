import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHARED_PILOT_LINES, sharedPilotSurveyRequestSchema } from '@agent-republic/domain';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';
import { SharedPilotRuntime } from '../src/lib/shared-pilot-runtime';

const START = 1_800_000_000_000;
const requestId = () => randomUUID();
const move = (place: 'works' | 'cafe', id = requestId()) => ({ requestId: id, action: 'moveTo', destination: { place } });

describe.skipIf(!process.getBuiltinModule?.('node:sqlite'))('shared construction center survey', () => {
  let folder: string, file: string, at: number, store: SharedPilotStore | undefined;
  beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'nexciv-survey-')); file = join(folder, 'survey.sqlite'); at = START; });
  afterEach(() => { store?.close(); store = undefined; rmSync(folder, { recursive: true, force: true }); });
  function open() { return store = new SharedPilotStore(file, () => at); }
  function reopen() { store!.close(); store = undefined; return open(); }
  function setup() { const s = open(); return { s, a: s.issueCredential('01').token, b: s.issueCredential('02').token }; }
  function coffee(s: SharedPilotStore, a: string, b: string) {
    const { meetingId } = s.socialAction(a, { requestId: requestId(), action: 'invite', target: '02', venue: 'cafe' });
    s.socialAction(b, { requestId: requestId(), action: 'respond', meetingId, decision: 'accept' });
    const one = s.moveTo(a, move('cafe')), two = s.moveTo(b, move('cafe'));
    at = Math.max(one.arrivesAt, two.arrivesAt);
    for (const [i, line] of SHARED_PILOT_LINES.entries()) {
      at = s.observe(a).social.meeting!.nextTurnAt;
      s.socialAction(i % 2 ? b : a, { requestId: requestId(), action: 'say', meetingId, line });
    }
    at = s.observe(a).social.meeting!.nextTurnAt;
    expect(s.observe(a).social.meeting?.status).toBe('completed');
    return meetingId;
  }

  it('requires a completed conversation, excludes spoofed evidence and permits an independent denial', () => {
    const { s, a, b } = setup();
    expect(sharedPilotSurveyRequestSchema.safeParse({ requestId: requestId(), action: 'submitSurvey', taskId: requestId(), result: 'complete', residentId: '02' }).success).toBe(false);
    expect(() => s.surveyAction(a, { requestId: requestId(), action: 'proposeSurvey', meetingId: requestId() })).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    const meetingId = coffee(s, a, b);
    const proposal = { requestId: requestId(), action: 'proposeSurvey', meetingId };
    const first = s.surveyAction(a, proposal);
    expect(s.surveyAction(a, proposal)).toEqual(first);
    expect(() => s.moveTo(a, move('works', proposal.requestId))).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => s.surveyAction(a, { requestId: requestId(), action: 'respondSurvey', taskId: first.taskId, decision: 'accept' })).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    s.surveyAction(b, { requestId: requestId(), action: 'respondSurvey', taskId: first.taskId, decision: 'decline' });
    expect(s.observe(a).survey.task?.status).toBe('declined');
    expect(s.observe(b).survey.report).toBeNull();
    expect(() => s.surveyAction(a, { ...proposal, requestId: requestId() })).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('requires actual distinct arrival, separate observation durations, and both submissions; preserves one report after restart', () => {
    const { s, a, b } = setup();
    const meetingId = coffee(s, a, b);
    const { taskId } = s.surveyAction(a, { requestId: requestId(), action: 'proposeSurvey', meetingId });
    s.surveyAction(b, { requestId: requestId(), action: 'respondSurvey', taskId, decision: 'accept' });
    expect(() => s.moveTo(a, move('cafe'))).toThrowError(expect.objectContaining({ code: 'BUSY' }));
    expect(() => s.socialAction(a, { requestId: requestId(), action: 'invite', target: '02', venue: 'cafe' })).toThrowError(expect.objectContaining({ code: 'BUSY' }));
    const one = s.moveTo(a, move('works')), two = s.moveTo(b, move('works'));
    at = Math.min(one.arrivesAt, two.arrivesAt);
    expect(s.observe(a).survey.arrived).toHaveLength(1);
    expect(() => s.surveyAction(a, { requestId: requestId(), action: 'inspectSurvey', taskId, checkId: 'entrance-path' })).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    at = Math.max(one.arrivesAt, two.arrivesAt);
    const arrived = s.observe(a);
    expect(arrived.survey.task?.status).toBe('surveying');
    expect(arrived.survey.arrived).toEqual(['01', '02']);
    expect(arrived.residents.map(({ position }) => position[2])).toEqual([67.346, 60.55]);
    expect(() => s.surveyAction(a, { requestId: requestId(), action: 'inspectSurvey', taskId, checkId: 'pedestrian-passage' })).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    const inspect1 = { requestId: requestId(), action: 'inspectSurvey', taskId, checkId: 'entrance-path' };
    const inspect2 = { requestId: requestId(), action: 'inspectSurvey', taskId, checkId: 'pedestrian-passage' };
    s.surveyAction(a, inspect1); s.surveyAction(b, inspect2);
    const submit1 = { requestId: requestId(), action: 'submitSurvey', taskId };
    expect(() => s.surveyAction(a, submit1)).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => s.moveTo(a, move('cafe'))).toThrowError(expect.objectContaining({ code: 'BUSY' }));
    at += 8000;
    s.surveyAction(a, submit1);
    expect(s.observe(b).survey.completed).toBe(0);
    expect(s.observe(b).survey.report).toBeNull();
    const next = reopen();
    const submit2 = { requestId: requestId(), action: 'submitSurvey', taskId };
    const receipt = next.surveyAction(b, submit2);
    expect(next.surveyAction(b, submit2)).toEqual(receipt);
    const final = next.observe(a);
    expect(final.survey.completed).toBe(1);
    expect(final.survey.report?.sourceMeetingId).toBe(meetingId);
    expect(final.survey.report?.findings.map(({ residentId, checkId }) => [residentId, checkId])).toEqual([['01', 'entrance-path'], ['02', 'pedestrian-passage']]);
    expect(final.survey.events.filter(({ kind }) => kind === 'SURVEY_COMPLETED')).toHaveLength(1);
    expect(next.observe(b).survey).toEqual(final.survey);
    expect(JSON.stringify(final.survey)).not.toContain('requestId');
    expect(reopen().observe(a).survey.report).toEqual(final.survey.report);
  });

  it('migrates v2 preserving completed coffee memory and expiry never substitutes for a report', () => {
    const { s, a, b } = setup();
    const meetingId = coffee(s, a, b);
    s.close(); store = undefined;
    const sqlite = process.getBuiltinModule!('node:sqlite') as typeof import('node:sqlite');
    const db = new sqlite.DatabaseSync(file);
    // Fresh temporary fixture emulates a v2 file.
    db.exec('DROP TABLE shared_pilot_profiles; DROP TABLE shared_pilot_survey; PRAGMA user_version=2'); db.close();
    const migrated = open();
    expect(migrated.observe(b).privateSocial.encounters).toBe(1);
    const { taskId } = migrated.surveyAction(a, { requestId: requestId(), action: 'proposeSurvey', meetingId });
    migrated.surveyAction(b, { requestId: requestId(), action: 'respondSurvey', taskId, decision: 'accept' });
    at += 150000;
    expect(migrated.observe(a).survey.task?.status).toBe('expired');
    expect(migrated.observe(a).survey.completed).toBe(0);
  });

  it('runs both authenticated rule clients from coffee agreement through a real shared report', () => {
    const runtime = new SharedPilotRuntime(file, () => at);
    try {
      for (let i = 0; i < 240; i++) {
        at = START + i * 1000; runtime.tick();
        if (runtime.snapshot().survey.completed > 0) break;
      }
      const result = runtime.snapshot();
      expect(result.survey.task?.status).toBe('completed');
      expect(result.survey.report?.findings).toHaveLength(2);
      expect(result.survey.events.map(({ kind }) => kind)).toEqual(['SURVEY_PROPOSED', 'SURVEY_ACCEPTED', 'SURVEY_ON_SITE', 'SURVEY_INSPECTING', 'SURVEY_INSPECTING', 'SURVEY_RECORDED', 'SURVEY_RECORDED', 'SURVEY_COMPLETED']);
      expect(result.social.completedMeetings).toBe(1);
    } finally { runtime.close(); }
  });
});
