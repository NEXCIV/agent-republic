import type { DatabaseSync } from 'node:sqlite';
import { SHARED_PILOT_PROVENANCE, sharedPilotMoveRequestSchema, sharedPilotSpeechSchema, type SharedPilotResidentId } from '@agent-republic/domain';
import { z } from 'zod';
import { FISHING_SPOT, type CityPoint } from './cafe-geometry';

type Resident = SharedPilotResidentId;
export const PIER_ANGLER = { kind: 'person', id: 'pier.angler' } as const;
export const PIER_ANGLER_NAME = '北岸钓客 · 阿澄';
export const ANGLER_POSITION: CityPoint = [72.45, 0.09, -186.8];
export const FISHING_WAIT: Record<Resident, CityPoint> = { '01': [71, 0.09, -188], '02': [71.85, 0.09, -188] };
const approach = 3100;
const cast = 1500;
const wait = 10000;
const reel = 1800;
const leave = 3100;
export const FISHING_TIMING = { approach, cast, wait, reel, leave, total: approach + cast + wait + reel + leave };
const provenance = { mode: 'DEMO', provenance: SHARED_PILOT_PROVENANCE } as const;
const resultText = { released: '钓到一条小鱼，解钩后放回湖里。', noCatch: '这一竿没有钓到鱼，已收竿。' } as const;
type Result = keyof typeof resultText;
export type FishingStage = 'travelling' | 'queued' | 'approaching' | 'casting' | 'fishing' | 'reeling' | 'leaving' | 'completed';
export const FISHING_STATUS: Record<FishingStage, string> = {
  travelling: '前往北岸码头', queued: '在码头等钓位', approaching: '走向钓位',
  casting: '抛竿', fishing: '看浮漂等鱼', reeling: '收竿', leaving: '收好钓具', completed: '钓鱼结束',
};
export const goFishingSchema = z.object({ action: z.literal('goFishing'), requestId: sharedPilotMoveRequestSchema.shape.requestId }).strict();
export const fishingTalkSchema = z.object({
  action: z.literal('fishingTalk'), question: sharedPilotSpeechSchema.refine(text => !/[\p{Cc}\p{Cf}]/u.test(text)),
}).strict();
export type GoFishing = z.infer<typeof goFishingSchema>;
export type FishingTalk = z.infer<typeof fishingTalkSchema>;

export function fishingOutcome(at: number, id: Resident): Result {
  const roll = Math.imul(at + (id === '02' ? 1 : 0), 0x9e3779b1) >>> 29;
  return roll < 5 ? 'released' : 'noCatch';
}

function phaseAt(elapsed: number) {
  const startCast = approach;
  const startWaiting = startCast + cast;
  const startReel = startWaiting + wait;
  const startLeaving = startReel + reel;
  if (elapsed < startCast) return { stage: 'approaching' as const, progress: elapsed / approach };
  if (elapsed < startWaiting) return { stage: 'casting' as const, progress: (elapsed - startCast) / cast };
  if (elapsed < startReel) return { stage: 'fishing' as const, progress: (elapsed - startWaiting) / wait };
  if (elapsed < startLeaving) return { stage: 'reeling' as const, progress: (elapsed - startReel) / reel };
  return { stage: 'leaving' as const, progress: (elapsed - startLeaving) / leave };
}

export function fishingPose(visit: { residentId: Resident; startsAt: number | null }, at: number) {
  if (visit.startsAt === null) return;
  const elapsed = at - visit.startsAt;
  if (elapsed < 0 || elapsed >= FISHING_TIMING.total) return;
  const phase = phaseAt(elapsed);
  const start = FISHING_WAIT[visit.residentId];
  const [x, y, z] = FISHING_SPOT;
  const walking = phase.stage === 'approaching' || phase.stage === 'leaving';
  if (!walking) return { ...phase, point: FISHING_SPOT, facing: [x + 2, y, z] as CityPoint, walking };
  const first = start[2] - z;
  const second = x - start[0];
  const remaining = phase.stage === 'leaving' ? 1 - phase.progress : phase.progress;
  const sample = (distance: number): CityPoint => {
    const metres = Math.max(0, Math.min(first + second, distance));
    return [start[0] + Math.max(0, metres - first), y, start[2] - Math.min(first, metres)];
  };
  const distance = remaining * (first + second);
  return { ...phase, walking, point: sample(distance), facing: sample(distance + (phase.stage === 'leaving' ? -0.25 : 0.25)) };
}

export const FISHING_TABLE = `CREATE TABLE shared_pilot_fishing (
  movement_seq INTEGER PRIMARY KEY REFERENCES shared_pilot_moves(seq),
  starts_at INTEGER, result TEXT NOT NULL CHECK(result IN ('released','noCatch'))
);`;
type Row = { movement_seq: number; starts_at: number | null; result: Result; resident_id: Resident;
  request_id: string; started_at: number; arrives_at: number };
const selection = `SELECT f.*, m.resident_id, m.request_id, m.started_at, m.arrives_at
  FROM shared_pilot_fishing f JOIN shared_pilot_moves m ON m.seq=f.movement_seq`;

export class FishingVisits {
  constructor(private readonly db: DatabaseSync) {}

  find(id: Resident, requestId: string) {
    return this.db.prepare(`${selection} WHERE m.resident_id=? AND m.request_id=?`).get(id, requestId) as Row | undefined;
  }

  active(at: number, id?: Resident) {
    return Boolean(this.db.prepare(`${selection} WHERE (? IS NULL OR m.resident_id=?) AND (f.starts_at IS NULL OR f.starts_at + ?>?) LIMIT 1`)
      .get(id ?? null, id ?? null, FISHING_TIMING.total, at));
  }

  insert(movement: number, result: Result) {
    this.db.prepare('INSERT INTO shared_pilot_fishing (movement_seq,result) VALUES (?,?)').run(movement, result);
  }

  receipt(row: Row) {
    return { ...provenance, action: 'goFishing' as const, requestId: row.request_id, residentId: row.resident_id,
      acceptedAt: row.started_at, arrivesAt: row.arrives_at };
  }

  settle() {
    const ready = this.db.prepare(`${selection} WHERE f.starts_at IS NULL AND m.completed_at IS NOT NULL
      ORDER BY m.arrives_at, f.movement_seq`).all() as Row[];
    if (!ready.length) return;
    const last = this.db.prepare('SELECT MAX(starts_at) AS last FROM shared_pilot_fishing').get()?.last;
    let freeAt = typeof last === 'number' ? last + FISHING_TIMING.total : 0;
    const schedule = this.db.prepare('UPDATE shared_pilot_fishing SET starts_at=? WHERE movement_seq=?');
    for (const row of ready) {
      const start = Math.max(row.arrives_at, freeAt);
      schedule.run(start, row.movement_seq);
      freeAt = start + FISHING_TIMING.total;
    }
  }

  view(at: number) {
    const rows = (this.db.prepare(`${selection} ORDER BY f.movement_seq DESC LIMIT 16`).all() as Row[]).reverse();
    const visits = rows.map(row => {
      const startsAt = row.starts_at;
      const endsAt = startsAt === null ? null : startsAt + FISHING_TIMING.total;
      const stage: FishingStage = at < row.arrives_at ? 'travelling' : startsAt === null || at < startsAt ? 'queued'
        : at >= endsAt! ? 'completed' : phaseAt(at - startsAt).stage;
      return { id: `fishing-${row.movement_seq}`, residentId: row.resident_id, stage, startsAt, endsAt,
        result: stage === 'completed' ? { outcome: row.result, text: resultText[row.result], recordedAt: endsAt! } : null };
    });
    type Kind = 'FISH_REQUESTED' | 'FISH_QUEUED' | 'FISH_CAST' | 'FISH_FINISHED';
    const events = visits.flatMap((visit, index) => {
      const row = rows[index]!;
      const id = visit.residentId;
      const event = (kind: Kind, happenedAt: number, text: string) => ({ ...provenance, kind,
        id: `${visit.id}-${kind}`, residentId: id, happenedAt, text });
      const log = [event('FISH_REQUESTED', row.started_at, `${id} 号出发去北岸码头钓鱼。`)];
      if (visit.startsAt !== null) {
        if (visit.startsAt > row.arrives_at) log.push(event('FISH_QUEUED', row.arrives_at, `${id} 号已到码头，正在等钓位。`));
        if (at >= visit.startsAt + approach) log.push(event('FISH_CAST', visit.startsAt + approach, `${id} 号在北岸码头抛竿。`));
        if (visit.result) log.push(event('FISH_FINISHED', visit.result.recordedAt, `${id} 号${visit.result.text}`));
      }
      return log;
    }).sort((a, b) => a.happenedAt - b.happenedAt);
    const occupied = visits.some(visit => visit.stage !== 'travelling' && visit.stage !== 'queued' && visit.stage !== 'completed');
    return { visits, events, occupied, queued: visits.filter(visit => visit.stage === 'queued').length };
  }

  talk(question: string, at: number) {
    const { occupied, queued } = this.view(at);
    const status = occupied ? `钓位有人，现有 ${queued} 位等候。前一位收竿走开后，按到场顺序轮换。` : '钓位空着，到码头就能开钓。';
    const text = /在哪|哪里|路线|怎么走|怎么去|where/i.test(question)
      ? `沿北岸步道走上木栈道。靠湖的尽头是钓位，靠步道的地方可以等候。 ${status}`
      : /鱼种|上钩|浮漂|鱼饵|钓到|fish/i.test(question) ? '湖里有小鱼。等浮漂动了再收线，钓到就放回湖里。'
        : status;
    return { ...provenance, text };
  }
}
