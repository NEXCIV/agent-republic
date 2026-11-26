import type { CafeDemoStore } from './cafe-demo-store';

export function cafeSnapshot(data: ReturnType<CafeDemoStore['read']>) {
  if (!data) return null;
  const { phase, since, until, place, energy, events, requestedActivity, fishResult, observer } = data.run;
  return { ...data, run: { phase, since, until, place, energy, events, requestedActivity, fishResult, observer } };
}
