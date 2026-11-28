import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';
import { modelChoices } from '../src/lib/shared-pilot-model';

it('authorizes intake and reserves a surveyed inspection point without accepting client evidence', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexciv-works-'));
  const store = new SharedPilotStore(path.join(directory, 'shared.sqlite'), () => 100000);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    const command = { action: 'inspectWorks', requestId: randomUUID(), checkId: 'entrance-path' };
    const { session } = store.claim({ name: '小满', avatar: 'citizen' }, ['01'], '');
    expect(() => store.requestInspection(session, command, ['02'])).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => store.requestInspection(a, { ...command, residentId: '02', observedAt: 1 })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => store.worksTalk('这里能巡查吗？', a)).toThrow(expect.objectContaining({ code: 'UNREACHABLE' }));
    const accepted = store.requestInspection(session, command, ['01']);
    expect(store.requestInspection(a, command)).toEqual(accepted);
    expect(() => store.requestInspection(a, { ...command, checkId: 'pedestrian-passage' })).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => store.requestInspection(b, { ...command, requestId: randomUUID() })).toThrow(expect.objectContaining({ code: 'BUSY' }));
    expect(() => store.moveTo(a, { action: 'moveTo', requestId: randomUUID(), destination: { place: 'plaza' } })).toThrow(expect.objectContaining({ code: 'BUSY' }));
    expect(store.worksTalk('这里能巡查吗？').text).toContain('已安排');
    const other = store.requestInspection(b, { ...command, requestId: randomUUID(), checkId: 'pedestrian-passage' });
    expect(other).toMatchObject({ checkId: 'pedestrian-passage', residentId: '02' });
    expect(store.worksTalk('这里能巡查吗？').text).toContain('两个巡查点的任务都已安排');
    expect(JSON.stringify(store.observe(b).works)).not.toContain(command.requestId);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('keeps the resident at the surveyed point until observation has elapsed and reconstructs one report after restart', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexciv-works-'));
  const filename = path.join(directory, 'shared.sqlite');
  let now = 100000;
  let store = new SharedPilotStore(filename, () => now);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    const receipt = store.requestInspection(a, { action: 'inspectWorks', requestId: randomUUID(), checkId: 'entrance-path' });
    expect(store.observe(b).works.visits[0]).toMatchObject({ stage: 'travelling', report: null });
    now = receipt.arrivesAt;
    const onSite = store.observe(b);
    expect(onSite.works.visits[0]).toMatchObject({ stage: 'observing', report: null });
    expect(onSite.residents[0]?.position[2]).toBeCloseTo(67.346);
    expect(modelChoices(store.observe(a)).map(({ id }) => id)).toEqual(['wait']);
    expect(store.worksTalk('哪里能等候？', a).text).toContain('等候区');
    now = receipt.reportAt - 1;
    expect(() => store.moveTo(a, { action: 'moveTo', requestId: randomUUID(), destination: { place: 'plaza' } })).toThrow(expect.objectContaining({ code: 'BUSY' }));
    store.close();
    store = new SharedPilotStore(filename, () => now);
    expect(store.observe(a).works.visits[0]?.report).toBeNull();
    now++;
    const done = store.observe(b).works;
    expect(done.visits[0]).toMatchObject({ stage: 'completed', report: { recordedAt: now, position: onSite.residents[0]?.position } });
    expect(done.events.filter(({ kind }) => kind === 'INSPECTION_RECORDED')).toHaveLength(1);
    expect(modelChoices(store.observe(a)).filter(({ id }) => id.startsWith('works:')).map(({ id }) => id))
      .toEqual(['works:pedestrian-passage']);
    expect(store.observe(a).works).toEqual(done);
    store.moveTo(a, { action: 'moveTo', requestId: randomUUID(), destination: { place: 'plaza' } });
    expect(store.observe(a).works).toEqual(done);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('accepts only the owner goal, then chooses an available check from the site state on arrival', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'nexciv-works-brief-'));
  const filename = path.join(folder, 'shared.sqlite');
  let now = 100000;
  let store = new SharedPilotStore(filename, () => now);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    const { session } = store.claim({ name: '小满', avatar: 'citizen' }, ['01'], '');
    const goal = { action: 'surveyWorksSite', requestId: randomUUID() };
    expect(() => store.startWorksBrief('', goal, ['01'])).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => store.startWorksBrief(session, goal, ['02'])).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => store.startWorksBrief(session, { ...goal, checkId: 'entrance-path', residentId: '02' }, ['01']))
      .toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    const receipt = store.startWorksBrief(session, goal, ['01']);
    expect(store.startWorksBrief(session, goal, ['01'])).toEqual(receipt);
    expect(() => store.moveTo(a, { ...goal, action: 'moveTo', destination: { place: 'works' } }))
      .toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => store.startWorksBrief(session, { ...goal, requestId: randomUUID() }, ['01']))
      .toThrow(expect.objectContaining({ code: 'BUSY' }));
    expect(store.observe(b).works.briefs[0]).toMatchObject({ residentId: '01', stage: 'travelling', decision: null, visit: null });
    expect(JSON.stringify(store.observe(b))).not.toContain(goal.requestId);
    now = receipt.arrivesAt - 1;
    store.requestInspection(b, { action: 'inspectWorks', requestId: randomUUID(), checkId: 'entrance-path' });
    expect(store.observe(b).works.briefs[0]?.decision).toBeNull();
    now++;
    store.close();
    store = new SharedPilotStore(filename, () => now);
    const brief = store.observe(a).works.briefs[0]!;
    expect(brief.decision).toMatchObject({ checkId: 'pedestrian-passage', managerReply: expect.stringContaining('已安排') });
    expect(brief.visit).toMatchObject({ checkId: 'pedestrian-passage', report: null });
    expect(store.startWorksBrief(session, goal, ['01'])).toEqual(receipt);
    now = brief.visit!.reportAt - 1;
    expect(store.observe(a).works.briefs[0]!.visit?.report).toBeNull();
    now++;
    expect(store.observe(a).works.briefs[0]).toMatchObject({ stage: 'completed', visit: { report: { recordedAt: now } } });
    expect(store.observe(a).works.visits.filter(visit => visit.residentId === '01')).toHaveLength(1);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
