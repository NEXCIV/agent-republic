export const THEATRE_PROGRAMME_ID = 'harbour-lights-1';
export const THEATRE_PROGRAMME_NAME = '城市灯潮';
export const THEATRE_CUES = [
  { id: 'shoreline', name: '沿岸引灯', start: 8000, end: 21000, suggestion: '可以让外围灯线再慢一点展开。' },
  { id: 'water', name: '水面回声', start: 21000, end: 36000, suggestion: '可以压低冷光，让中央装置的轮廓更清楚。' },
  { id: 'finale', name: '暖光收束', start: 36000, end: 47000, suggestion: '可以让最后一圈暖光多停留一会儿。' },
] as const;
export type TheatreCueId = typeof THEATRE_CUES[number]['id'];
export type TheatreCue = { id: TheatreCueId; name: string; startsAt: number; endsAt: number };

export function theatreCues(opensAt: number): TheatreCue[] {
  return THEATRE_CUES.map(({ id, name, start, end }) => ({ id, name, startsAt: opensAt + start, endsAt: opensAt + end }));
}
