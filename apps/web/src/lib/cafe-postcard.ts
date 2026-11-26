import type { CafeRun } from './cafe-life';
import type { NewspaperIssue } from './cafe-newspaper';

type ActivityEvent = CafeRun['events'][number];
export type CafePostcard = {
  shiftStartedAt: number;
  before?: ActivityEvent;
  events: ActivityEvent[];
  eventCount: number;
  issue?: Pick<NewspaperIssue, 'id' | 'headline'>;
};

export function buildCafePostcard(run: CafeRun, seenAt: number, issue?: NewspaperIssue): CafePostcard | undefined {
  const firstNew = run.events.findIndex((event) => event.at > seenAt);
  if (firstNew < 0) return undefined;
  const events = run.events.slice(firstNew);
  return {
    shiftStartedAt: run.events[0]!.at,
    before: run.events[firstNew - 1],
    events: events.slice(-3),
    eventCount: events.length,
    issue: issue && issue.publishedAt > seenAt ? { id: issue.id, headline: issue.headline } : undefined,
  };
}
