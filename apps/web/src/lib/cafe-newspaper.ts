import type { CafeRun } from './cafe-life';
import { OBSERVER_SPEAKERS, type ObserverSource } from './cafe-observer';
import type { CityActivity } from './city-activities';
import type { EveningRecord } from './evening-stroll';
import type { CityPoint } from './cafe-geometry';

export type NewspaperIssue = {
  id: string;
  publishedAt: number;
  headline: string;
  lead: string;
  sourceIds: string[];
};

export type NewspaperSnapshot = {
  issues: Pick<NewspaperIssue, 'id' | 'publishedAt' | 'headline'>[];
  current: { kind?: 'interview'; issue: NewspaperIssue; sources: ObserverSource[] } | CityNewspaperEdition | null;
};

type CityNewspaperSource = {
  id: string;
  title: string;
  place: string;
  at: number;
  notes: string[];
  position?: CityPoint;
  metres?: number;
};

export type CityNewspaperEdition = {
  kind: 'city';
  issue: NewspaperIssue;
  sources: CityNewspaperSource[];
  sceneActivityId: string;
};

function finishedEvent(activity: CityActivity, at: number) {
  if (activity.endsAt > at) return;
  return activity.events.find(({ type, at }) => type === 'completed' && at === activity.endsAt);
}

function strollSource(record: EveningRecord, title: string, at: number): CityNewspaperSource | undefined {
  const arrival = record.events.find((event) => event.type === 'checkpoint' && event.at === record.walk.arrivesAt);
  if (!finishedEvent(record, at) || !arrival || !arrival.position) return;
  return {
    id: record.requestId, at: arrival.at, place: record.walk.name, title,
    position: arrival.position, metres: Math.round(record.walk.metres),
    notes: [record.observation.lighting.detail, record.reason, arrival.text],
  };
}

export function writeLightingEdition(
  report: CityActivity | undefined, installation: CityActivity | undefined, strolls: EveningRecord[], at: number,
): CityNewspaperEdition | null {
  if (!report || !installation) return null;
  const submission = finishedEvent(report, at);
  const lit = finishedEvent(installation, at);
  if (!submission || !lit?.position || submission.at > installation.startedAt) return null;
  const later = strolls.find((record) => {
    const { lighting } = record.observation;
    return record.startedAt >= lit.at && lighting.state === 'lit'
      && lighting.source?.activityId === installation.requestId && lighting.source.litAt === lit.at;
  });
  if (!later) return null;
  const followUp = strollSource(later, '03 号 · 亮灯后', at);
  if (!followUp) return null;
  const earlier = strolls.find((record) => record.startedAt < lit.at && record.observation.lighting.state === 'not-installed');
  const before = earlier ? strollSource(earlier, '03 号 · 亮灯前的选择', at) : undefined;
  const sources: CityNewspaperSource[] = [
    { id: report.requestId, at: submission.at, title: '01 号 · 路灯调研报告', place: '议事公告栏', notes: [submission.text] },
    { id: installation.requestId, at: lit.at, title: '02 号 · 试点灯完工', place: '北岸东侧步道', position: lit.position, notes: [lit.text] },
    ...(before ? [before] : []),
    followUp,
  ];
  const headline = later.selection.optionId === 'waterfront' ? '试点灯亮起，03 号走到临水步道' : '湖畔试点灯亮起后的居民记录';
  const route = before ? `03 号亮灯前选择前往${before.place}，亮灯后到达${followUp.place}。`
    : `03 号在出发前读到了亮灯记录，随后到达${followUp.place}。`;
  return {
    kind: 'city', sceneActivityId: installation.requestId, sources,
    issue: {
      id: `city-${installation.requestId}`, publishedAt: later.endsAt, headline,
      lead: `01 号提交路灯调研报告后，02 号在北岸东侧装好一盏低位灯。${route}`,
      sourceIds: sources.map(({ id }) => id),
    },
  };
}

export function writeNewspaper(shiftId: string, run: CafeRun): NewspaperIssue | null {
  const assignment = run.observer;
  if (run.phase !== 'done' || assignment?.sources.length !== 2) return null;

  const sources = assignment.sources;
  if (new Set(sources.map((source) => source.speaker)).size !== 2 || new Set(sources.map((source) => source.id)).size !== 2) return null;
  if (!sources.every((source) => source.quote.trim()
    && OBSERVER_SPEAKERS[source.speaker]?.place === source.place
    && source.angle === assignment.angle
    && source.at <= run.since
    && run.events.some((event) => event.sourceId === source.id && event.at === source.at))) return null;

  return {
    id: shiftId,
    publishedAt: run.since,
    headline: '北岸码头的灯该照哪里？',
    lead: assignment.angle === 'safety'
      ? '傍晚的北岸码头，哪里最看不清？观察员 01 号从咖啡摊问到木栈道，两位受访者指出了不同的位置。'
      : '码头加灯会带来什么变化？观察员 01 号采访了收摊时经过这里的阿禾，以及常来钓鱼的一位居民，听到了他们对照明方向的建议。',
    sourceIds: sources.map((source) => source.id),
  };
}
