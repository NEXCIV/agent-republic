import { SHARED_PILOT_PROVENANCE, sharedPilotMoveRequestSchema, type SharedPilotResidentId } from '@agent-republic/domain';
import { z } from 'zod';
import { CAFE_BENCH, CAFE_BENCH_FRONT, CAFE_HOST, type CityPoint } from './cafe-geometry';
import { ANGLER_POSITION, PIER_ANGLER_NAME } from './shared-pilot-fishing';
import { WORKS_MANAGER_POSITION } from './shared-pilot-works';

export const BENCH_ID = 'cafe.bench';
export const BENCH_RANGE = 20;
export const BENCH_REST_MS = 12_000;
export const BENCH_COOLDOWN_MS = 90_000;
export const BENCH_SEAT: CityPoint = [CAFE_BENCH[0], CAFE_BENCH[1], CAFE_BENCH[2] - 0.16];
export const benchRestSchema = z.object({
  action: z.literal('restAtBench'), benchId: z.literal(BENCH_ID), requestId: sharedPilotMoveRequestSchema.shape.requestId,
}).strict();
export type BenchRest = z.infer<typeof benchRestSchema>;
export type BenchMovement = { seq: number; resident_id: SharedPilotResidentId; started_at: number; arrives_at: number; completed_at: number | null };

export function benchRest(row: BenchMovement, at: number) {
  const endsAt = row.arrives_at + BENCH_REST_MS;
  const stage = row.completed_at === null ? 'travelling' : at < endsAt ? 'resting' : 'completed';
  return {
    id: `bench-${row.seq}`, residentId: row.resident_id, benchId: BENCH_ID, stage, acceptedAt: row.started_at,
    arrivesAt: row.arrives_at, endsAt, mode: 'DEMO' as const, provenance: SHARED_PILOT_PROVENANCE,
  } as const;
}

export function benchProjection(rows: BenchMovement[], at: number) {
  const visits = rows.map(row => benchRest(row, at));
  const events = visits.flatMap(visit => {
    const { id, residentId, provenance } = visit;
    const started = { id: `${id}-start`, residentId, provenance, kind: 'REST_REQUESTED' as const,
      happenedAt: visit.acceptedAt, text: `${residentId} 号准备去咖啡街长椅歇一会儿。` };
    const seated = { id: `${id}-seated`, residentId, provenance, kind: 'REST_STARTED' as const,
      happenedAt: visit.arrivesAt, text: `${residentId} 号在咖啡街长椅坐下休息。` };
    const finished = { id: `${id}-finished`, residentId, provenance, kind: 'REST_FINISHED' as const,
      happenedAt: visit.endsAt, text: `${residentId} 号在咖啡街休息完毕。` };
    return visit.stage === 'travelling' ? [started] : visit.stage === 'resting' ? [started, seated] : [started, seated, finished];
  }).sort((a, b) => a.happenedAt - b.happenedAt);
  return { visits, events, occupied: visits.some(visit => visit.stage !== 'completed') };
}

const contacts = [
  { id: 'cafe.vendor', name: '咖啡摊主 · 阿棠', point: CAFE_HOST, activity: '询问菜单或队伍' },
  { id: 'works.manager', name: '建设中心现场管理员', point: WORKS_MANAGER_POSITION, activity: '询问可领的巡查点' },
  { id: 'pier.angler', name: PIER_ANGLER_NAME, point: ANGLER_POSITION, activity: '询问钓位或等候情况' },
] as const;

export function localDistance(a: CityPoint, b: CityPoint) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

export function nearbyAt(position: CityPoint, benchAvailable: boolean, restReason?: string) {
  const nearby = contacts.flatMap(({ point, ...contact }) => {
    const distance = localDistance(position, point);
    return distance <= 22 ? [{ ...contact, kind: 'person' as const, metres: Math.round(distance) }] : [];
  });
  const distance = localDistance(position, CAFE_BENCH_FRONT);
  return distance <= BENCH_RANGE ? [...nearby, {
    id: BENCH_ID, kind: 'object' as const, name: '咖啡街长椅', metres: Math.round(distance),
    activity: '坐下休息', available: benchAvailable, reason: restReason,
  }] : nearby;
}
