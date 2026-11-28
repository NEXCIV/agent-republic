import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';
import { modelChoices } from '../src/lib/shared-pilot-model';

it('authorizes only the owning browser and disallows client-reported arrival or service', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'nexciv-cafe-order-'));
  const store = new SharedPilotStore(path.join(folder, 'world.sqlite'), () => 100000);
  try {
    const input = { action: 'orderCoffee', requestId: randomUUID(), drink: 'flat-white' };
    const { session } = store.claim({ name: '小满', avatar: 'builder' }, ['01'], '');
    const { token } = store.issueCredential('01');
    expect(() => store.orderCoffee('', input, ['01'])).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => store.orderCoffee(session, input, ['02'])).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => store.orderCoffee(token, { ...input, arrivedAt: 0 })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => store.orderCoffee(session, { ...input, residentId: '02' }, ['01'])).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => store.cafeTalk('现在要排多久？', token)).toThrow(expect.objectContaining({ code: 'UNREACHABLE' }));
    const accepted = store.orderCoffee(session, input, ['01']);
    expect(accepted.residentId).toBe('01');
    expect(store.orderCoffee(token, input)).toEqual(accepted);
    expect(() => store.orderCoffee(token, { ...input, drink: 'americano' })).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(store.observe(token).cafe.orders).toHaveLength(1);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it('serves by physical arrival, shows a real wait, and recovers both orders after restart', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'nexciv-cafe-order-'));
  const file = path.join(folder, 'world.sqlite');
  let now = 100000;
  let store = new SharedPilotStore(file, () => now);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    expect(modelChoices(store.observe(a)).some(({ id }) => id.startsWith('coffee:'))).toBe(false);
    expect(modelChoices(store.observe(b)).filter(({ id }) => id.startsWith('coffee:')).map(({ id }) => id))
      .toEqual(['coffee:ask', 'coffee:flat-white', 'coffee:americano']);
    const first = store.orderCoffee(a, { action: 'orderCoffee', requestId: randomUUID(), drink: 'flat-white' });
    expect(store.observe(a).cafe.orders[0]!.stage).toBe('travelling');
    now = first.arrivesAt - 1200;
    const second = store.orderCoffee(b, { action: 'orderCoffee', requestId: randomUUID(), drink: 'flat-white' });
    expect(second.arrivesAt).toBeLessThan(first.arrivesAt);
    now = first.arrivesAt;
    const busy = store.observe(a).cafe;
    expect(busy.orders.map(({ residentId, stage }) => [residentId, stage])).toEqual([['01', 'queued'], ['02', 'approaching']]);
    expect(store.cafeTalk('现在要排多久？').text).toMatch(/有.*杯/);
    expect(modelChoices(store.observe(a)).map(({ id }) => id)).toEqual(['wait', 'coffee:ask']);
    expect(store.observe(b).cafe).toEqual(busy);
    expect(JSON.stringify(busy)).not.toContain(first.requestId);
    expect(() => store.moveTo(a, { action: 'moveTo', requestId: randomUUID(), destination: { place: 'plaza' } })).toThrow(expect.objectContaining({ code: 'BUSY' }));
    store.close();
    store = new SharedPilotStore(file, () => now);
    expect(store.observe(a).cafe).toEqual(busy);
    now += 35000;
    const done = store.observe(b).cafe;
    expect(done.orders.every(order => order.stage === 'completed')).toBe(true);
    expect(done.events.filter(event => event.kind === 'PICKED_UP').map(event => event.residentId)).toEqual(['02', '01']);
    expect(done.events.filter(event => event.kind === 'QUEUED').map(event => event.residentId)).toEqual(['01']);
    expect(store.cafeTalk('现在要排多久？').text).toMatch(/空/);
    expect(store.observe(a).cafe).toEqual(done);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it('lets a resident choose to sip only their own collected coffee and recovers one result after restart', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'nexciv-cafe-sip-'));
  const file = path.join(folder, 'world.sqlite');
  let now = 100000;
  let store = new SharedPilotStore(file, () => now);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    const order = store.orderCoffee(a, { action: 'orderCoffee', requestId: randomUUID(), drink: 'americano' });
    const orderId = store.observe(a).cafe.orders[0]!.id;
    const sip = { action: 'drinkCoffee', orderId };
    expect(() => store.drinkCoffee('', sip)).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => store.drinkCoffee(b, sip)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => store.drinkCoffee(a, { ...sip, sippedAt: now })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => store.drinkCoffee(a, sip)).toThrow(expect.objectContaining({ code: 'BUSY' }));
    now = order.arrivesAt + 10000;
    store.close();
    const old = new DatabaseSync(file);
    old.exec('ALTER TABLE shared_pilot_cafe_orders DROP COLUMN sipped_at; PRAGMA user_version=9;');
    old.close();
    store = new SharedPilotStore(file, () => now);
    const afterPickup = store.observe(a);
    expect(afterPickup.cafe.orders[0]).toMatchObject({ stage: 'completed', sip: null });
    const choices = modelChoices(afterPickup);
    expect(choices.find(({ id }) => id === `coffee:sip:${orderId}`)?.command).toEqual(sip);
    expect(choices.some(({ id }) => id.startsWith('move:'))).toBe(true);
    const accepted = store.drinkCoffee(a, sip);
    expect(accepted.residentId).toBe('01');
    expect(accepted.endsAt).toBeGreaterThan(accepted.startedAt);
    expect(store.observe(b).cafe.orders[0]!.sip).toEqual({ startedAt: accepted.startedAt, endsAt: accepted.endsAt });
    expect(() => store.moveTo(a, { action: 'moveTo', requestId: randomUUID(), destination: { place: 'plaza' } }))
      .toThrow(expect.objectContaining({ code: 'BUSY' }));
    expect(store.observe(a).cafe.events.some(event => event.kind === 'SIPPED')).toBe(false);
    store.close();
    now = accepted.endsAt;
    store = new SharedPilotStore(file, () => now);
    expect(store.drinkCoffee(a, sip)).toEqual(accepted);
    expect(store.observe(a).cafe.events.filter(event => event.kind === 'SIPPED')).toHaveLength(1);
    expect(modelChoices(store.observe(a)).some(({ id }) => id.startsWith('coffee:sip:'))).toBe(false);
    expect(store.moveTo(a, { action: 'moveTo', requestId: randomUUID(), destination: { place: 'plaza' } }).arrivesAt).toBeGreaterThan(now);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
