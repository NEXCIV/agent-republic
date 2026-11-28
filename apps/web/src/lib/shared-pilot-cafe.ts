import type { DatabaseSync } from 'node:sqlite';
import type { SharedPilotResidentId } from '@agent-republic/domain';
import { z } from 'zod';
import { CAFE_COUNTER, CAFE_STALL, type CityPoint } from './cafe-geometry';

export const COFFEE_MENU = { 'flat-white': '馥芮白', americano: '美式咖啡' } as const;
const drinkSchema = z.enum(['flat-white', 'americano']);
export const orderCoffeeSchema = z.object({
  action: z.literal('orderCoffee'),
  requestId: z.string().uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  drink: drinkSchema,
}).strict();
export type OrderCoffee = z.infer<typeof orderCoffeeSchema>;
export const cafeTalkSchema = z.object({
  action: z.literal('cafeTalk'),
  question: z.string().trim().min(1).max(120).refine(text => !/[\p{Cc}\p{Cf}]/u.test(text)),
}).strict();
export type CafeTalk = z.infer<typeof cafeTalkSchema>;
type Drink = OrderCoffee['drink'];
type Resident = SharedPilotResidentId;
type OrderRow = {
  seq: number; resident_id: Resident; request_id: string; drink: Drink;
  requested_at: number; arrives_at: number; serves_at: number | null;
};
export type CoffeeStage = 'travelling' | 'queued' | 'approaching' | 'serving' | 'leaving' | 'completed';
export const CAFE_VENDOR = { kind: 'person', id: 'cafe.vendor' } as const;
export const CAFE_VENDOR_NAME = '咖啡摊主 · 阿棠';
export const COFFEE_STATUS: Record<CoffeeStage, string> = {
  travelling: '前往咖啡摊', queued: '在咖啡摊排队', approaching: '走向柜台',
  serving: '在柜台等咖啡', leaving: '已取餐', completed: '已取餐',
};
export const CAFE_QUEUE: Record<Resident, CityPoint> = {
  '01': [12.6, CAFE_COUNTER[1], 70.85],
  '02': [11.675, CAFE_COUNTER[1], 70.45],
};
const APPROACH = { '01': 1250, '02': 2200 };
const PREPARATION_MS = 5600;
const SERVICE_SLOT_MS = 10000;
const source = { provenance: 'AI_SIMULATED', mode: 'DEMO' } as const;
export const CAFE_ORDERS_TABLE = `CREATE TABLE shared_pilot_cafe_orders (
  seq INTEGER PRIMARY KEY, resident_id TEXT NOT NULL REFERENCES shared_pilot_residents(id),
  request_id TEXT NOT NULL, drink TEXT NOT NULL CHECK(drink IN ('flat-white','americano')),
  requested_at INTEGER NOT NULL, arrives_at INTEGER NOT NULL CHECK(arrives_at>=requested_at),
  serves_at INTEGER CHECK(serves_at>=arrives_at), UNIQUE(resident_id, request_id)
);`;

export function cafePose(order: { residentId: Resident; servesAt: number | null; finishedAt: number | null }, at: number) {
  const { residentId, servesAt, finishedAt } = order;
  if (servesAt === null || finishedAt === null || at < servesAt || at >= finishedAt) return;
  const untilReady = servesAt + APPROACH[residentId] + PREPARATION_MS;
  const leaving = at >= untilReady;
  const walking = at < servesAt + APPROACH[residentId] || leaving;
  const start = CAFE_QUEUE[residentId];
  const turn: CityPoint = residentId === '01' ? start : [11.66, start[1], 71.56];
  const distanceToTurn = Math.hypot(turn[0] - start[0], turn[2] - start[2]);
  const distanceToCounter = Math.hypot(CAFE_COUNTER[0] - turn[0], CAFE_COUNTER[2] - turn[2]);
  const length = distanceToTurn + distanceToCounter;
  const progress = leaving ? 1 - (at - untilReady) / (finishedAt - untilReady) : Math.min(1, (at - servesAt) / APPROACH[residentId]);
  const distance = progress * length;
  const position = (metres: number): CityPoint => {
    const d = Math.max(0, Math.min(length, metres));
    if (d < distanceToTurn) return [start[0] + (turn[0] - start[0]) * d / distanceToTurn, start[1], start[2] + (turn[2] - start[2]) * d / distanceToTurn];
    const ratio = (d - distanceToTurn) / distanceToCounter;
    return [turn[0] + (CAFE_COUNTER[0] - turn[0]) * ratio, turn[1], turn[2] + (CAFE_COUNTER[2] - turn[2]) * ratio];
  };
  return { point: position(distance), facing: walking ? position(distance + (leaving ? -0.3 : 0.3)) : CAFE_STALL, walking };
}

function stateAt(row: OrderRow, at: number) {
  const { serves_at: servesAt, resident_id: residentId } = row;
  const counterAt = servesAt === null ? null : servesAt + APPROACH[residentId];
  const readyAt = counterAt === null ? null : counterAt + PREPARATION_MS;
  const finishedAt = servesAt === null ? null : servesAt + SERVICE_SLOT_MS;
  const stage: CoffeeStage = at < row.arrives_at ? 'travelling' : servesAt === null || at < servesAt ? 'queued'
    : at >= finishedAt! ? 'completed' : at >= readyAt! ? 'leaving' : at < counterAt! ? 'approaching' : 'serving';
  return { id: `coffee-${row.seq}`, residentId, drink: row.drink, stage, servesAt, counterAt, readyAt, finishedAt, arrivesAt: row.arrives_at };
}

export class CafeOrders {
  constructor(private readonly db: DatabaseSync) {}

  find(actor: Resident, requestId: string) {
    return this.db.prepare('SELECT * FROM shared_pilot_cafe_orders WHERE resident_id=? AND request_id=?').get(actor, requestId) as OrderRow | undefined;
  }

  active(actor: Resident, at: number) {
    return Boolean(this.db.prepare('SELECT seq FROM shared_pilot_cafe_orders WHERE resident_id=? AND (serves_at IS NULL OR serves_at + ?>?)').get(actor, SERVICE_SLOT_MS, at));
  }

  hasActiveOrder(at: number) {
    return Boolean(this.db.prepare('SELECT seq FROM shared_pilot_cafe_orders WHERE serves_at IS NULL OR serves_at + ?>?').get(SERVICE_SLOT_MS, at));
  }

  insert(actor: Resident, request: OrderCoffee, at: number, arrivesAt: number) {
    this.db.prepare('INSERT INTO shared_pilot_cafe_orders (resident_id,request_id,drink,requested_at,arrives_at) VALUES (?,?,?,?,?)')
      .run(actor, request.requestId, request.drink, at, arrivesAt);
  }

  receipt(row: OrderRow) {
    return { ...source, action: 'orderCoffee' as const, requestId: row.request_id, residentId: row.resident_id,
      drink: row.drink, acceptedAt: row.requested_at, arrivesAt: row.arrives_at };
  }

  settle(at: number) {
    const arrivals = this.db.prepare('SELECT seq,arrives_at FROM shared_pilot_cafe_orders WHERE serves_at IS NULL AND arrives_at<=? ORDER BY arrives_at,seq')
      .all(at) as { seq: number; arrives_at: number }[];
    if (!arrivals.length) return;
    const lastStart = this.db.prepare('SELECT MAX(serves_at) AS last FROM shared_pilot_cafe_orders').get()?.last;
    let freeAt = typeof lastStart === 'number' ? lastStart + SERVICE_SLOT_MS : 0;
    const schedule = this.db.prepare('UPDATE shared_pilot_cafe_orders SET serves_at=? WHERE seq=?');
    for (const { seq, arrives_at } of arrivals) {
      const start = Math.max(arrives_at, freeAt);
      schedule.run(start, seq);
      freeAt = start + SERVICE_SLOT_MS;
    }
  }

  view(at: number) {
    const rows = (this.db.prepare('SELECT * FROM shared_pilot_cafe_orders ORDER BY seq DESC LIMIT 24').all() as OrderRow[]).reverse();
    const orders = rows.map(row => stateAt(row, at));
    type Event = { id: string; kind: 'ORDER_REQUESTED' | 'QUEUED' | 'SERVING' | 'PICKED_UP'; residentId: Resident; happenedAt: number; text: string; provenance: 'AI_SIMULATED' };
    const events: Event[] = [];
    for (const [index, order] of orders.entries()) {
      const emit = (kind: Event['kind'], happenedAt: number, text: string) => {
        if (happenedAt <= at) events.push({ id: `${order.id}-${kind}`, kind, happenedAt, residentId: order.residentId, text, provenance: source.provenance });
      };
      const drink = COFFEE_MENU[order.drink];
      emit('ORDER_REQUESTED', rows[index]!.requested_at, `${order.residentId} 号要去咖啡摊点一杯${drink}。`);
      if (order.servesAt !== null && order.counterAt !== null && order.readyAt !== null) {
        if (order.servesAt > order.arrivesAt) emit('QUEUED', order.arrivesAt, `${order.residentId} 号已到咖啡摊，正在等前一杯。`);
        emit('SERVING', order.counterAt, `${order.residentId} 号在柜台点了${drink}，阿棠开始准备。`);
        emit('PICKED_UP', order.readyAt, `${order.residentId} 号取走了${drink}。`);
      }
    }
    const serving = orders.some(({ stage }) => stage === 'approaching' || stage === 'serving' || stage === 'leaving');
    const queued = orders.filter(({ stage }) => stage === 'queued').length;
    return { orders, serving, queued, events: events.sort((a, b) => a.happenedAt - b.happenedAt).slice(-24) };
  }

  talk(question: string, at: number) {
    const { serving, queued } = this.view(at);
    const busy = queued + Number(serving);
    const wait = busy ? `眼下有 ${busy} 杯在做或在等。到柜台后我会按到店顺序叫号。` : '柜台现在空着，到了就能点，不用排队。';
    let text = `你好！今天有馥芮白和美式。 ${wait}`;
    if (/排|等|多久|忙|空|queue|wait/i.test(question)) text = wait;
    else if (/湖|坐|休息|景|lake|sit/i.test(question)) text = '摊边往东就有长椅，想看水可以去北边的湖岸。';
    else if (/推荐|甜|奶|浓|美式|菜单|喝|menu|coffee|milk/i.test(question)) text = '想要奶味柔和一点，就点馥芮白。喜欢清爽、咖啡味直接一点，可以选美式。';
    else if (/价格|多少钱|付|price|pay/i.test(question)) text = '今天是试营业，这两款咖啡都可以免费试饮。';
    return { ...source, text };
  }
}
