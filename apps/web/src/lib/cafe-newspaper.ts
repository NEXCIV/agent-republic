import type { CafeRun } from './cafe-life';
import { OBSERVER_SPEAKERS, type ObserverSource } from './cafe-observer';

export type NewspaperIssue = {
  id: string;
  publishedAt: number;
  headline: string;
  lead: string;
  sourceIds: string[];
};

export type NewspaperSnapshot = {
  issues: Pick<NewspaperIssue, 'id' | 'publishedAt' | 'headline'>[];
  current: { issue: NewspaperIssue; sources: ObserverSource[] } | null;
};

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
