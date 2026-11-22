import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { worldFrameV1Schema } from '@agent-republic/domain';
import { createDemoPair } from '../src/social/demo-decisions.js';
import { DemoSocialStore } from '../src/social/demo-store.js';

const demo = worldFrameV1Schema.parse(JSON.parse(readFileSync(
  new URL('../../../examples/world-frame.demo.json', import.meta.url), 'utf8',
)));

describe('CIVRUM E3-05 social decisions', () => {
  it('declines a rule-based recipient without verified evidence', () => {
    const frame = structuredClone(demo);
    frame.society.agentSummaries[1]!.persona = 'RULE_BASED';
    const session = createDemoPair(frame);
    const [inviter, recipient] = session.pair;
    expect(session.resolve('invitation', inviter, recipient, false, new Date())).toMatchObject({
      status: 'DECLINED', reason: 'RECIPIENT_REQUIRES_VERIFIED_EVIDENCE', messages: [], memories: [],
    });
  });

  it('does not discover an inactive participant or invent a topic', () => {
    const frame = structuredClone(demo);
    frame.society.agentSummaries[1]!.active = false;
    expect(createDemoPair(frame).hasTopic).toBe(false);
    const empty = structuredClone(demo);
    empty.facts.projects = [];
    empty.facts.proposals = [];
    expect(createDemoPair(empty).hasTopic).toBe(false);
  });

  it('blocks the demo store from using the normal app database', () => {
    expect(() => new DemoSocialStore('postgres://localhost/agent_republic', demo)).toThrow(/dedicated database/);
  });
});

const databaseUrl = process.env.SOCIAL_DEMO_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('CIVRUM E3-05 social worker with PostgreSQL', () => {
  let store: DemoSocialStore;
  let db: Client;
  let scopedUrl: string;

  beforeEach(async () => {
    const schema = 'test_' + randomUUID().replaceAll('-', '');
    const url = new URL(databaseUrl!);
    if (!url.pathname.endsWith('_test_social_demo')) throw new Error('Use a dedicated social demo test database');
    const admin = new Client({ connectionString: url.toString() });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
    } finally {
      await admin.end();
    }
    url.searchParams.set('options', `-c search_path=${schema}`);
    scopedUrl = url.toString();
    db = new Client({ connectionString: scopedUrl });
    await db.connect();
    store = new DemoSocialStore(scopedUrl, demo);
    await store.initialize();
  });

  afterEach(async () => {
    await store?.close();
    await db?.end();
  });

  async function allowResponse() {
    await db.query("UPDATE demo_social_sessions SET invited_at = invited_at - interval '6 seconds' WHERE status = 'INVITED'");
  }

  it('deduplicates concurrent work and uses remembered interaction after restart', async () => {
    const parallel = new DemoSocialStore(scopedUrl, demo);
    let started;
    try {
      started = (await Promise.all([store.step(), parallel.step()])).filter((session) => session !== null);
    } finally {
      await parallel.close();
    }
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ status: 'INVITED', inviter_id: 'agent-01' });
    expect(await store.step()).toBeNull();

    await store.close();
    store = new DemoSocialStore(scopedUrl, demo);
    await allowResponse();
    const first = await store.step();
    expect(first).toMatchObject({ id: started[0]?.id, status: 'COMPLETED', reason: 'ACCEPTED' });
    expect(first?.messages).toHaveLength(4);
    expect(first?.memories.map((entry) => entry.agentId).sort()).toEqual(['agent-01', 'agent-02']);
    expect(first?.memories[0]?.sourceIds).toContain(`${first?.id}:0`);
    expect(await store.step()).toBeNull();

    await db.query("UPDATE demo_social_sessions SET invited_at = invited_at - interval '2 minutes', resolved_at = resolved_at - interval '2 minutes'");
    await store.close();
    store = new DemoSocialStore(scopedUrl, demo);
    const next = await store.step();
    expect(next).toMatchObject({ status: 'INVITED', inviter_id: 'agent-02', recalled_session_id: first?.id });
    await allowResponse();
    const followUp = await store.step();
    expect(followUp).toMatchObject({ id: next?.id, status: 'COMPLETED', reason: 'ACCEPTED_AFTER_RECALL' });
    expect(followUp?.messages).toHaveLength(2);
    expect(await store.history()).toHaveLength(2);
  });

  it('persists pause, cancels the outstanding invite and skips work while paused', async () => {
    const first = await store.step();
    await store.setPaused('agent-02', true);
    await store.close();
    store = new DemoSocialStore(scopedUrl, demo);
    expect(await store.step()).toBeNull();
    expect((await store.history())[0]).toMatchObject({
      id: first?.id, status: 'CANCELLED', reason: 'PARTICIPANT_PAUSED', messages: [], memories: [],
    });
    await store.setPaused('agent-02', false);
    await db.query("UPDATE demo_social_sessions SET invited_at = invited_at - interval '2 minutes', resolved_at = resolved_at - interval '2 minutes'");
    expect(await store.step()).toMatchObject({ status: 'INVITED' });
  });

  it('persists a decline without creating dialogue, memories or an immediate retry', async () => {
    const frame = structuredClone(demo);
    frame.society.agentSummaries[1]!.persona = 'RULE_BASED';
    await store.close();
    store = new DemoSocialStore(scopedUrl, frame);
    const invitation = await store.step();
    await allowResponse();
    expect(await store.step()).toMatchObject({
      id: invitation?.id, status: 'DECLINED', reason: 'RECIPIENT_REQUIRES_VERIFIED_EVIDENCE',
    });
    expect(await store.history()).toMatchObject([{
      id: invitation?.id, status: 'DECLINED', messages: [], memories: [],
    }]);
    expect(await store.step()).toBeNull();
  });
});
